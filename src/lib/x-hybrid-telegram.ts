type RawTelegramRecord = Record<string, unknown>;

export type XHybridTelegramInput = {
  sourceId: string;
  messageUrl: string;
  text: string;
  createdAt: string;
  raw: RawTelegramRecord | null;
};

export type XHybridTelegramCandidate = {
  sourceId: string;
  messageUrl: string;
  createdAt: string;
  username: string | null;
  tweetId: string | null;
  tweetUrl: string | null;
  summary: string;
};

type XHybridSourceStatusLike = {
  status: string;
  tweetId?: string | null;
  updatedAt?: string | null;
};

type TweetLike = {
  id: string;
  text: string;
  createdAt: string;
};

const TWEET_URL_RE =
  /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status\/(\d+)/gi;
const TELEGRAM_MONITOR_HEADER_RE =
  /^(?:\u4f60\u5173\u6ce8\u7684\u7528\u6237|\u7528\u6237\u6240\u5c5e\u5206\u7ec4)[:\uFF1A]/;
const TELEGRAM_MONITOR_TITLE_RE = /^\u{1F31F}?\s*\u76d1\u63a7\u5230\u65b0\u63a8\u6587/u;
const TELEGRAM_CONTENT_PREFIX_RE =
  /^(?:\u63a8\u6587\u5185\u5bb9|\u5f15\u7528\u5185\u5bb9|\u4e0a\u6587\u5185\u5bb9|\u56de\u5e16\u5185\u5bb9)[:\uFF1A]\s*/;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function appendUrlSource(urls: string[], value: string) {
  if (!value || urls.includes(value)) return;
  urls.push(value);
}

function collectUrls(value: unknown, urls: string[]) {
  if (!value) return;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      appendUrlSource(urls, value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
    return;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectUrls(nested, urls);
    }
  }
}

function collectButtonUrls(value: unknown, urls: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectButtonUrls(item, urls);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "buttons",
    "button",
    "reply_markup",
    "replyMarkup",
    "inline_keyboard",
    "inlineKeyboard",
  ]) {
    collectButtonUrlValues(record[key], urls);
  }

  for (const nested of Object.values(record)) {
    collectButtonUrls(nested, urls);
  }
}

function collectButtonUrlValues(value: unknown, urls: string[]) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectButtonUrlValues(item, urls);
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const url = stringValue(record.url);
  if (/^https?:\/\//i.test(url)) {
    appendUrlSource(urls, url);
  }
  for (const nested of Object.values(record)) {
    collectButtonUrlValues(nested, urls);
  }
}

export function extractTweetUrl(
  text: string,
  raw: RawTelegramRecord | null,
): { username: string; tweetId: string; tweetUrl: string } | null {
  const urls: string[] = [];
  collectButtonUrls(raw, urls);
  appendUrlSource(urls, text);
  collectUrls(raw, urls);

  for (const source of urls) {
    TWEET_URL_RE.lastIndex = 0;
    const match = TWEET_URL_RE.exec(source);
    if (!match) continue;
    const username = match[1];
    const tweetId = match[2];
    return {
      username,
      tweetId,
      tweetUrl: `https://x.com/${username}/status/${tweetId}`,
    };
  }

  return null;
}

function extractSummary(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const contentIndex = lines.findIndex((line) =>
    TELEGRAM_CONTENT_PREFIX_RE.test(line),
  );
  if (contentIndex >= 0) {
    return lines
      .slice(contentIndex)
      .map((line, index) =>
        index === 0 ? line.replace(TELEGRAM_CONTENT_PREFIX_RE, "").trim() : line,
      )
      .join("\n")
      .replace(TWEET_URL_RE, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .trim();
  }

  return lines
    .filter((line) => !TELEGRAM_MONITOR_HEADER_RE.test(line))
    .filter((line) => !TELEGRAM_MONITOR_TITLE_RE.test(line))
    .join(" ")
    .replace(TWEET_URL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUsernameFromText(text: string): string | null {
  const atMatch = text.match(/@([A-Za-z0-9_]{1,20})/);
  if (atMatch) return atMatch[1];
  return null;
}

export function parseXHybridTelegramCandidate(
  input: XHybridTelegramInput,
): XHybridTelegramCandidate | null {
  const text = stringValue(input.text);
  const tweetUrl = extractTweetUrl(text, input.raw);
  const summary = extractSummary(text);

  if (!tweetUrl && !summary) {
    return null;
  }

  return {
    sourceId: input.sourceId,
    messageUrl: input.messageUrl,
    createdAt: input.createdAt,
    username: tweetUrl?.username ?? extractUsernameFromText(text),
    tweetId: tweetUrl?.tweetId ?? null,
    tweetUrl: tweetUrl?.tweetUrl ?? null,
    summary,
  };
}

export function shouldProcessXHybridSourceStatus(
  status: XHybridSourceStatusLike | null,
  options: {
    retryErrors?: boolean;
    candidateTweetId?: string | null;
    pendingRetryMs?: number;
    nowMs?: number;
  } = {},
): boolean {
  const candidateTweetId = options.candidateTweetId?.trim();
  const previousTweetId = status?.tweetId?.trim();
  if (
    status &&
    candidateTweetId &&
    previousTweetId &&
    candidateTweetId !== previousTweetId
  ) {
    return true;
  }

  if (!status) return true;
  if (status.status === "pending") {
    const pendingRetryMs = options.pendingRetryMs;
    if (!pendingRetryMs || pendingRetryMs <= 0) return true;
    const updatedAtMs = Date.parse(status.updatedAt || "");
    if (!Number.isFinite(updatedAtMs)) return true;
    return (options.nowMs ?? Date.now()) - updatedAtMs >= pendingRetryMs;
  }
  return options.retryErrors === true && status.status === "error";
}

export function isRetryableXHybridFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b429\b|too frequently|rate.?limit|限流)/i.test(message);
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^\p{Letter}\p{Number}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return new Set(tokens);
}

function scoreTweet(candidate: XHybridTelegramCandidate, tweet: TweetLike): number {
  if (candidate.tweetId && tweet.id === candidate.tweetId) {
    return 1_000_000;
  }

  const wanted = tokenize(candidate.summary);
  const actual = tokenize(tweet.text);
  if (wanted.size === 0 || actual.size === 0) {
    return 0;
  }

  let score = 0;
  for (const token of wanted) {
    if (actual.has(token)) score += 1;
  }
  return score / wanted.size;
}

export function selectBestTweetMatch<T extends TweetLike>(
  candidate: XHybridTelegramCandidate,
  tweets: T[],
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const tweet of tweets) {
    const score = scoreTweet(candidate, tweet);
    if (score > bestScore) {
      best = tweet;
      bestScore = score;
    }
  }

  return bestScore >= 0.2 || bestScore >= 1_000_000 ? best : null;
}
