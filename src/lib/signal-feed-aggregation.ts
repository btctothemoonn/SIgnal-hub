export type SignalFeedAggregationItem = {
  id: string;
  text: string;
  link: string;
  createdAt: string;
  quotedTweet?: { link: string; relation?: string } | null;
};

export type SignalFeedGroup<T extends SignalFeedAggregationItem> = T & {
  originalUrl: string | null;
  representativeId: string;
  members: T[];
  aliases: string[];
};

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
const TELEGRAM_HOSTS = new Set(["t.me", "www.t.me", "telegram.me", "www.telegram.me"]);
const SHORT_LINK_HOSTS = new Set(["t.co", "bit.ly", "tinyurl.com"]);
const TRACKING_QUERY_KEY = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;

function parseHttpUrl(raw: string | null | undefined) {
  if (!raw || /[\s\u0000-\u001f\u007f]/.test(raw) || /%(?![\da-f]{2})/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

function telegramMessagePath(url: URL) {
  if (!TELEGRAM_HOSTS.has(url.hostname)) return null;
  const match = url.pathname.match(/^\/(?:s\/)?([a-z][\w]{3,}|c\/\d+)\/([1-9]\d*)\/?$/i);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : null;
}

/** Only links that identify a particular post or article can identify a group. */
export function canonicalSignalOriginalUrl(raw: string | null | undefined): string | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  if (X_HOSTS.has(url.hostname)) {
    const match = url.pathname.match(/^\/(?:[\w]+\/status|i\/(?:web\/)?status)\/([1-9]\d*)(?:\/(?:photo|video)\/\d+)?\/?$/);
    return match ? `https://x.com/i/status/${match[1]}` : null;
  }
  if (TELEGRAM_HOSTS.has(url.hostname)) {
    const path = telegramMessagePath(url);
    return path ? `https://t.me${path}` : null;
  }
  if (url.hostname === "github.com" || url.hostname === "www.github.com") {
    // Repository/profile/list pages are shared by unrelated developments.
    const concrete = /^\/[^/]+\/[^/]+\/(?:issues\/\d+|pull\/\d+|discussions\/\d+|commit\/[a-f0-9]+|releases\/tag\/[^/]+)\/?$/i;
    if (!concrete.test(url.pathname)) return null;
  }
  if (
    SHORT_LINK_HOSTS.has(url.hostname) ||
    /^\/(?:index\.(?:html?|php))?$/i.test(url.pathname) ||
    /^\/(?:@[^/]+|profiles?|users?|authors?|channels?)(?:\/|$)/i.test(url.pathname) ||
    /^\/(?:categor(?:y|ies)|tags?|search|topics?|archives?|docs?|documentation)(?:\/|$)/i.test(url.pathname) ||
    /^(?:docs?|documentation)\./i.test(url.hostname) ||
    /^(?:www\.)?(?:facebook\.com|instagram\.com|linkedin\.com|youtube\.com|truthsocial\.com)$/.test(url.hostname)
  ) return null;

  // Keep semantic parameters and their spelling/order intact. URLSearchParams
  // serialization would also rewrite spaces/escaping in otherwise exact URLs.
  try {
    const query = url.search.slice(1).split("&").filter((part) => {
      const key = decodeURIComponent(part.split("=", 1)[0].replace(/\+/g, " "));
      return !TRACKING_QUERY_KEY.test(key);
    }).join("&");
    return `${url.origin}${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  } catch {
    return null;
  }
}

export function telegramOriginalAction(message: { messageUrl?: string | null; channelLink: string }) {
  const url = parseHttpUrl(message.messageUrl);
  const hasMessageLink = url && telegramMessagePath(url) !== null;
  return {
    link: hasMessageLink ? message.messageUrl! : message.channelLink,
    linkLabel: hasMessageLink ? "查看原文" : "查看频道",
  };
}

export function signalFeedOriginalUrl(item: SignalFeedAggregationItem): string | null {
  const candidates = new Set<string>();
  for (const raw of item.text.match(/https?:\/\/[^\s<>"']+/g) || []) {
    const canonical = canonicalSignalOriginalUrl(raw.replace(/[.,;:!?)\]}，。；！]+$/, ""));
    if (canonical) candidates.add(canonical);
  }
  if (item.quotedTweet?.relation === "quote") {
    const quotedUrl = canonicalSignalOriginalUrl(item.quotedTweet.link);
    if (quotedUrl) candidates.add(quotedUrl);
  }
  if (candidates.size > 1) return null;
  if (candidates.size === 1) return [...candidates][0];

  // A post without an outbound story link can match a copy linking to that post.
  const ownUrl = parseHttpUrl(item.link);
  return ownUrl && (X_HOSTS.has(ownUrl.hostname) || TELEGRAM_HOSTS.has(ownUrl.hostname))
    ? canonicalSignalOriginalUrl(item.link)
    : null;
}

export function aggregateSignalFeed<T extends SignalFeedAggregationItem>(
  items: readonly T[],
  previous: readonly SignalFeedGroup<T>[] = [],
): SignalFeedGroup<T>[] {
  const previousById = new Map(previous.map((group) => [group.id, group]));
  const groups = new Map<string, { originalUrl: string | null; members: T[] }>();
  for (const item of items) {
    const originalUrl = signalFeedOriginalUrl(item);
    // Use a story ID from its first appearance, even before there is a copy.
    const id = originalUrl ? `original:${originalUrl}` : item.id;
    const group = groups.get(id);
    if (group) group.members.push(item);
    else groups.set(id, { originalUrl, members: [item] });
  }
  return [...groups].map(([id, { originalUrl, members }]) => {
    const earlier = previousById.get(id);
    const retained = members.find((item) => item.id === earlier?.representativeId);
    const representative = retained || members.reduce((oldest, item) =>
      Date.parse(item.createdAt) < Date.parse(oldest.createdAt) ? item : oldest,
    );
    return {
      ...representative,
      id,
      createdAt: retained ? earlier!.createdAt : representative.createdAt,
      originalUrl,
      representativeId: representative.id,
      members,
      aliases: members.map((member) => member.id),
    };
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function resolveSignalFeedRowId<T extends SignalFeedAggregationItem>(
  groups: readonly SignalFeedGroup<T>[],
  itemId: string,
) {
  return groups.find((group) => group.id === itemId || group.aliases.includes(itemId))?.id || itemId;
}

export function signalFeedUnreadMemberCount<T extends SignalFeedAggregationItem>(
  group: SignalFeedGroup<T>,
  readIds: ReadonlySet<string>,
) {
  return group.members.reduce((count, member) => count + (readIds.has(member.id) ? 0 : 1), 0);
}
