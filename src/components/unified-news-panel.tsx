"use client";

import Image from "next/image";
import {
  Fragment,
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  TelegramChannelWatch,
  TelegramDashboardSnapshot,
  TelegramMediaPreview,
} from "@/lib/telegram-channels";
import type {
  TwitterDashboardSnapshot,
  TwitterWatchAccount,
} from "@/lib/6551-twitter";
import { formatDisplayTime } from "@/lib/display-time";
import { shouldSkipTelegramChannelTranslation } from "@/lib/telegram-translation-policy";
import { isUsefulTranslation } from "@/lib/translation-quality";
import {
  ALL_SIGNAL_FEED_AUTHOR_FILTER,
  buildSignalFeedAuthorOptions,
  matchesSignalFeedAuthorFilter,
} from "@/lib/signal-feed-author-filter";
import {
  DEFAULT_SIGNAL_FEED_RANGE,
  SIGNAL_FEED_RANGE_OPTIONS,
  getSignalFeedRangeLimit,
  type SignalFeedRange,
} from "@/lib/signal-feed-range";
import { classifyXFeedSource } from "@/lib/x-feed-source";
import { DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS } from "@/lib/x-hybrid-backfill-options";
import { formatXHybridBackfillStatus } from "@/lib/x-hybrid-backfill-status";
import {
  getXSourceBadgeLabel,
  isMergedXSignalSource,
  matchesSignalFeedTab,
  type SignalFeedSource,
  type SignalFeedTab,
} from "@/lib/signal-feed-tabs";

const MAX_ALL_NEWS_ITEMS = 200;
const MAX_TELEGRAM_NEWS_ITEMS = 300;
const MAX_X_NEWS_ITEMS = 200;
const SNAPSHOT_REFRESH_MS = 30000;
const SIGNAL_FEED_AUTHOR_FAVORITES_KEY =
  "signal-hub:signal-feed-author-favorites";

function readSignalFeedAuthorFavorites() {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const raw = window.localStorage.getItem(SIGNAL_FEED_AUTHOR_FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set<string>();

    return new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set<string>();
  }
}

function writeSignalFeedAuthorFavorites(favorites: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SIGNAL_FEED_AUTHOR_FAVORITES_KEY,
    JSON.stringify([...favorites]),
  );
}

type UnifiedTranslation = {
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
} | null;

type UnifiedQuotedTweet = {
  id: string;
  text: string;
  createdAt: string;
  relation: "quote" | "reply";
  title: string;
  titleUrl: string;
  subtitle: string | null;
  link: string;
  media: TelegramMediaPreview | null;
  translation: UnifiedTranslation;
  avatar: string | null;
};

type UnifiedNewsItem = {
  id: string;
  source: SignalFeedSource;
  createdAt: string;
  sourceLabel: string;
  title: string;
  titleUrl: string;
  subtitle: string | null;
  text: string;
  translation: UnifiedTranslation;
  link: string;
  linkLabel: string;
  media: TelegramMediaPreview | null;
  quotedTweet: UnifiedQuotedTweet | null;
  metrics: string[];
  chips: string[];
  avatar: string | null;
};

function formatMetric(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatStatusTime(raw: string | null | undefined) {
  if (!raw) return "n/a";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "n/a";

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}])/g;

function renderTextWithLinks(text: string): ReactNode {
  if (!text) return text;
  const parts = text.split(URL_REGEX);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return (
        <a
          key={`url-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="text-accent underline decoration-accent/40 underline-offset-2 break-all hover:decoration-accent"
        >
          {part}
        </a>
      );
    }
    return <Fragment key={`txt-${index}`}>{part}</Fragment>;
  });
}

function formatLanguageTag(code: string) {
  if (!code || code === "unknown") {
    return "外文";
  }

  return code.toUpperCase();
}

function fallbackXAvatar(username: string | null | undefined) {
  const clean = username?.trim().replace(/^@+/, "").replace(/^truth:/, "");
  return clean ? `https://unavatar.io/twitter/${clean}` : null;
}

function parseEventPayload<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

function sortByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function limitNewsItems<T extends { createdAt: string }>(
  items: T[],
  limit = MAX_ALL_NEWS_ITEMS,
) {
  return sortByCreatedAt(items).slice(0, limit);
}

function mergeTelegramChannels(
  channels: TelegramChannelWatch[],
  incoming: TelegramChannelWatch[],
) {
  const channelMap = new Map<string, TelegramChannelWatch>();

  for (const channel of [...channels, ...incoming]) {
    channelMap.set(`${channel.channelId || channel.ref}:${channel.ref}`, channel);
  }

  return [...channelMap.values()];
}

function mergeTwitterWatchAccounts(
  accounts: TwitterWatchAccount[],
  incoming: TwitterWatchAccount[],
) {
  const accountMap = new Map<string, TwitterWatchAccount>();

  for (const account of [...accounts, ...incoming]) {
    accountMap.set(account.username, account);
  }

  return [...accountMap.values()];
}

function mergeFeeds<T extends { id: string; createdAt: string }>(
  current: T[],
  incoming: T[],
  limit = MAX_ALL_NEWS_ITEMS,
) {
  const feedMap = new Map<string, T>();

  for (const item of [...current, ...incoming]) {
    feedMap.set(item.id, item);
  }

  return limitNewsItems([...feedMap.values()], limit);
}

function mergeTelegramSnapshot(
  current: TelegramDashboardSnapshot,
  incoming: TelegramDashboardSnapshot,
  limit = MAX_TELEGRAM_NEWS_ITEMS,
): TelegramDashboardSnapshot {
  const mergedFeed = mergeFeeds(
    current.feed,
    incoming.feed,
    limit,
  );

  return {
    ...current,
    ...incoming,
    isConnected:
      incoming.status === "error"
        ? false
        : current.isConnected || incoming.isConnected,
    status: incoming.status,
    channels: mergeTelegramChannels(current.channels, incoming.channels),
    feed: mergedFeed,
  };
}

function mergeTwitterSnapshot(
  current: TwitterDashboardSnapshot,
  incoming: TwitterDashboardSnapshot,
  limit = MAX_X_NEWS_ITEMS,
): TwitterDashboardSnapshot {
  const mergedFeed = mergeFeeds(current.feed, incoming.feed, limit);

  return {
    ...current,
    ...incoming,
    isConnected: current.isConnected || incoming.isConnected,
    status:
      incoming.status === "error" && mergedFeed.length > 0 ? "live" : incoming.status,
    watchAccounts: mergeTwitterWatchAccounts(
      current.watchAccounts,
      incoming.watchAccounts,
    ),
    feed: mergedFeed,
  };
}

function toUnifiedTelegramItems(
  snapshot: TelegramDashboardSnapshot,
): UnifiedNewsItem[] {
  const avatarByChannel = new Map<string, string>();
  for (const channel of snapshot.channels) {
    if (!channel.avatar) {
      continue;
    }
    if (channel.channelId) {
      avatarByChannel.set(`id:${channel.channelId}`, channel.avatar);
    }
    if (channel.username) {
      avatarByChannel.set(`username:${channel.username.toLowerCase()}`, channel.avatar);
    }
    avatarByChannel.set(`ref:${channel.ref.toLowerCase()}`, channel.avatar);
  }

  return snapshot.feed.map((message) => {
    const avatar =
      message.channelAvatar ||
      (message.channelId && avatarByChannel.get(`id:${message.channelId}`)) ||
      (message.channelUsername &&
        avatarByChannel.get(`username:${message.channelUsername.toLowerCase()}`)) ||
      avatarByChannel.get(`ref:${message.channelRef.toLowerCase()}`) ||
      null;
    const quoted = message.quotedMessage;

    return {
    id: `telegram:${message.id}`,
    source: "telegram",
    createdAt: message.createdAt,
    sourceLabel: "Telegram",
    title: message.channelTitle,
    titleUrl: message.channelLink,
    subtitle: message.channelUsername ? `@${message.channelUsername}` : null,
    text: message.text,
    translation:
      !shouldSkipTelegramChannelTranslation({
        channelUsername: message.channelUsername,
        channelRef: message.channelRef,
        channelTitle: message.channelTitle,
      }) && isUsefulTranslation(message.text, message.translation)
        ? message.translation
        : null,
    link: message.channelLink,
    linkLabel: "查看频道",
    media: message.media,
    quotedTweet: quoted
      ? {
          id: quoted.id || `${message.id}:reply`,
          text: quoted.text,
          createdAt: quoted.createdAt,
          relation: "reply",
          title: quoted.channelTitle || message.channelTitle || "回复上文",
          titleUrl: quoted.messageUrl || "#",
          subtitle: quoted.channelUsername
            ? `@${quoted.channelUsername}`
            : message.channelUsername
              ? `@${message.channelUsername}`
              : null,
          link: quoted.messageUrl || "#",
          media: quoted.media,
          translation: null,
          avatar,
        }
      : null,
    metrics: [],
    chips: [],
    avatar,
    };
  });
}

function isTruthUsername(username: string) {
  return username.startsWith("truth:");
}

function formatXAuthorSubtitle(username: string, detail?: string | null) {
  const handle = username ? `@${username}` : "";
  const cleanDetail = detail?.trim();

  if (handle && cleanDetail) {
    return `${handle} · ${cleanDetail}`;
  }

  return handle || cleanDetail || null;
}

function toUnifiedTwitterItems(
  snapshot: TwitterDashboardSnapshot,
): UnifiedNewsItem[] {
  return snapshot.feed.map((tweet) => {
    const source = classifyXFeedSource(tweet);
    const isTruth = source === "truth";
    const displayUsername = isTruth
      ? tweet.username.replace(/^truth:/, "")
      : tweet.username;

    return {
      id: `x:${tweet.id}`,
      source,
      createdAt: tweet.createdAt,
      sourceLabel:
        source === "truth" ? "Truth" : source === "monitor985" ? "X-985" : "X-6551",
      title: tweet.displayName || `@${displayUsername}`,
      titleUrl: tweet.profileUrl,
      subtitle: formatXAuthorSubtitle(displayUsername, tweet.queryLabel),
      text: tweet.text,
      translation: isUsefulTranslation(tweet.text, tweet.translation)
        ? tweet.translation
        : null,
      link: tweet.tweetUrl,
      linkLabel: "查看原帖",
      media: tweet.media[0] ?? null,
      quotedTweet: tweet.quotedTweet
        ? {
            id: tweet.quotedTweet.id,
            text: tweet.quotedTweet.text,
            createdAt: tweet.quotedTweet.createdAt,
            relation: tweet.quotedTweet.relation === "reply" ? "reply" : "quote",
            title: tweet.quotedTweet.displayName || (tweet.quotedTweet.username
              ? `@${tweet.quotedTweet.username.replace(/^truth:/, "")}`
              : tweet.quotedTweet.relation === "reply"
                ? "回复上文"
                : "引用推文"),
            titleUrl: tweet.quotedTweet.profileUrl || "#",
            subtitle: formatXAuthorSubtitle(
              tweet.quotedTweet.username.replace(/^truth:/, ""),
            ),
            link: tweet.quotedTweet.tweetUrl || "#",
            media: tweet.quotedTweet.media[0] ?? null,
            translation: isUsefulTranslation(
              tweet.quotedTweet.text,
              tweet.quotedTweet.translation,
            )
              ? tweet.quotedTweet.translation
              : null,
            avatar: tweet.quotedTweet.userAvatar || fallbackXAvatar(tweet.quotedTweet.username),
          }
        : null,
      metrics: [
        ...(tweet.likes > 0 ? [`赞 ${formatMetric(tweet.likes)}`] : []),
        ...(tweet.retweets > 0 ? [`转 ${formatMetric(tweet.retweets)}`] : []),
        ...(tweet.replies > 0 ? [`评 ${formatMetric(tweet.replies)}`] : []),
        ...(tweet.views > 0 ? [`看 ${formatMetric(tweet.views)}`] : []),
      ],
      chips: tweet.hashtags.slice(0, 4).map((tag) => `#${tag}`),
      avatar: tweet.userAvatar,
    };
  });
}

function buildUnifiedFeed(
  telegramSnapshot: TelegramDashboardSnapshot,
  xSnapshot: TwitterDashboardSnapshot,
) {
  return sortByCreatedAt([
    ...toUnifiedTelegramItems(telegramSnapshot),
    ...toUnifiedTwitterItems(xSnapshot),
  ]);
}

function feedLimitForTab(tab: FeedTab, range: SignalFeedRange) {
  if (tab === "telegram") return getSignalFeedRangeLimit(range, "telegram");
  if (tab === "x" || tab === "truth") return getSignalFeedRangeLimit(range, "x");
  return getSignalFeedRangeLimit(range, "all");
}

function getMediaViewport(media: TelegramMediaPreview | null) {
  if (!media) return { width: 0, height: 0 };

  const aspect =
    media.width && media.height && media.height > 0
      ? media.width / media.height
      : 1.6;

  return {
    width: 600,
    height: Math.floor(600 / aspect),
  };
}

function requestTelegramSnapshot(options: {
  signal?: AbortSignal;
  range?: SignalFeedRange;
} = {}) {
  return fetch(snapshotRequestUrl("/api/telegram", options.range), {
    method: "GET",
    cache: "no-store",
    signal: options.signal,
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Telegram snapshot request failed (${response.status})`);
    }

    return (await response.json()) as TelegramDashboardSnapshot;
  });
}

function requestXSnapshot(options: {
  signal?: AbortSignal;
  range?: SignalFeedRange;
} = {}) {
  return fetch(snapshotRequestUrl("/api/x", options.range), {
    method: "GET",
    cache: "no-store",
    signal: options.signal,
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`X snapshot request failed (${response.status})`);
    }

    return (await response.json()) as TwitterDashboardSnapshot;
  });
}

function snapshotRequestUrl(path: string, range = DEFAULT_SIGNAL_FEED_RANGE) {
  if (range === DEFAULT_SIGNAL_FEED_RANGE) return path;
  const params = new URLSearchParams({ range });
  return `${path}?${params.toString()}`;
}

type Props = {
  initialTelegramSnapshot: TelegramDashboardSnapshot;
  initialXSnapshot: TwitterDashboardSnapshot;
  pollXSnapshot?: boolean;
  rail?: boolean;
  className?: string;
};

type XUsageResponse = {
  success: boolean;
  usage?: NonNullable<TwitterDashboardSnapshot["usage"]>;
  error?: string;
};

type XBackfillResponse = {
  success: boolean;
  lookbackHours?: number;
  checked: number;
  parsed: number;
  selected: number;
  enriched: number;
  failed: number;
  pointsReserved: number;
  quotedResolved: number;
  quotedPointsReserved: number;
  primaryRefreshes?: number;
  skippedAfter985Refresh?: number;
  skippedAlreadyProcessed?: number;
  skippedAlreadyIn985?: number;
  pendingGrace?: number;
  skippedNotConfigured?: number;
  skippedNoTweetId?: number;
  dryRun: boolean;
  usage?: NonNullable<TwitterDashboardSnapshot["usage"]>;
  error?: string;
};

type Monitor985RefreshResponse = {
  success: boolean;
  result?: {
    fetched: number;
    accepted: number;
    ignored: number;
    accountSource: "985" | "local";
    detail: string;
  };
  usage?: NonNullable<TwitterDashboardSnapshot["usage"]>;
  error?: string;
};

type FeedTab = SignalFeedTab;

const SOURCE_ICON: Record<string, { letter: string; tone: string }> = {
  telegram: { letter: "T", tone: "bg-info text-background" },
  x: { letter: "X", tone: "bg-foreground text-background" },
  monitor985: { letter: "985", tone: "bg-accent text-white" },
  truth: { letter: "TS", tone: "bg-success text-background" },
  alert: { letter: "!", tone: "bg-danger text-background" },
};

function getXSourceBadge(source: SignalFeedSource) {
  const label = getXSourceBadgeLabel(source);
  if (!label) return null;

  return {
    label,
    className:
      source === "monitor985"
        ? "border-accent/35 bg-accent/10 text-accent"
        : "border-info/35 bg-info-soft/60 text-info",
  };
}

const CopyButton = memo(function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="group/copy flex items-center gap-1 text-xs text-muted transition-colors hover:text-accent"
      aria-label="复制内容"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {copied ? <span className="text-accent">已复制</span> : null}
    </button>
  );
});


export function UnifiedNewsPanel({
  initialTelegramSnapshot,
  initialXSnapshot,
  pollXSnapshot = false,
  rail = false,
  className = "",
}: Props) {
  const [telegramSnapshot, setTelegramSnapshot] = useState(initialTelegramSnapshot);
  const [xSnapshot, setXSnapshot] = useState(initialXSnapshot);
  const [activeTab, setActiveTab] = useState<FeedTab>("all");
  const [feedRange, setFeedRange] = useState<SignalFeedRange>(
    DEFAULT_SIGNAL_FEED_RANGE,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState(ALL_SIGNAL_FEED_AUTHOR_FILTER);
  const [authorFavorites, setAuthorFavorites] = useState<Set<string>>(
    new Set(),
  );
  const [authorMenuOpen, setAuthorMenuOpen] = useState(false);
  const [readItems, setReadItems] = useState<Set<string>>(new Set());
  const [lightboxMedia, setLightboxMedia] = useState<TelegramMediaPreview | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const authorMenuRef = useRef<HTMLDivElement | null>(null);
  const [telegramRefreshBusy, setTelegramRefreshBusy] = useState(false);
  const [telegramManualStatus, setTelegramManualStatus] = useState<string | null>(null);
  const [xUsageBusy, setXUsageBusy] = useState(false);
  const [monitor985RefreshBusy, setMonitor985RefreshBusy] = useState(false);
  const [xCatchupBusy, setXCatchupBusy] = useState(false);
  const [xCatchupRunning, setXCatchupRunning] = useState(false);
  const [xCatchupStatus, setXCatchupStatus] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<{
    telegram: Set<string>;
    x: Set<string>;
  }>(() => ({
    telegram: new Set(initialTelegramSnapshot.feed.map((item) => item.id)),
    x: new Set(initialXSnapshot.feed.map((item) => item.id)),
  }));

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    setAuthorFavorites(readSignalFeedAuthorFavorites());
  }, []);

  useEffect(() => {
    if (!lightboxMedia) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxMedia(null);
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxMedia]);

  useEffect(() => {
    if (!authorMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        authorMenuRef.current?.contains(target)
      ) {
        return;
      }
      setAuthorMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAuthorMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [authorMenuOpen]);

  useEffect(() => {
    setSeenIds((current) => {
      const sources: Array<"telegram" | "x"> =
        activeTab === "all"
          ? ["telegram", "x"]
          : activeTab === "telegram"
            ? ["telegram"]
            : activeTab === "x" || activeTab === "truth"
              ? ["x"]
            : [];
      if (sources.length === 0) return current;

      const nextSets = {
        telegram: current.telegram,
        x: current.x,
      };
      let changed = false;
      for (const source of sources) {
        const feed =
          source === "telegram"
            ? telegramSnapshot.feed
            : xSnapshot.feed.filter((item) =>
                activeTab === "truth"
                  ? classifyXFeedSource(item) === "truth"
                  : activeTab === "x"
                    ? isMergedXSignalSource(classifyXFeedSource(item))
                    : true,
              );
        let nextSet: Set<string> | null = null;
        for (const item of feed) {
          if (!current[source].has(item.id)) {
            if (!nextSet) nextSet = new Set(current[source]);
            nextSet.add(item.id);
          }
        }
        if (nextSet) {
          nextSets[source] = nextSet;
          changed = true;
        }
      }
      return changed ? nextSets : current;
    });
  }, [activeTab, telegramSnapshot.feed, xSnapshot.feed]);

  const newCounts = useMemo(() => {
    const countUnseen = <T extends { id: string }>(
      feed: T[],
      seen: Set<string>,
    ) => feed.reduce((acc, item) => acc + (seen.has(item.id) ? 0 : 1), 0);
    const telegramNew = countUnseen(telegramSnapshot.feed, seenIds.telegram);
    const xNew = countUnseen(
      xSnapshot.feed.filter((item) =>
        isMergedXSignalSource(classifyXFeedSource(item)),
      ),
      seenIds.x,
    );
    const truthNew = countUnseen(
      xSnapshot.feed.filter((item) => isTruthUsername(item.username)),
      seenIds.x,
    );
    return {
      all: telegramNew + xNew + truthNew,
      telegram: telegramNew,
      x: xNew,
      truth: truthNew,
    };
  }, [telegramSnapshot.feed, xSnapshot.feed, seenIds]);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const unifiedFeed = useMemo(
    () => buildUnifiedFeed(telegramSnapshot, xSnapshot),
    [telegramSnapshot, xSnapshot],
  );

  const authorFilterOptions = useMemo(
    () =>
      buildSignalFeedAuthorOptions(
        unifiedFeed.filter((item) => matchesSignalFeedTab(item, activeTab)),
      ),
    [unifiedFeed, activeTab],
  );

  useEffect(() => {
    if (authorFilter === ALL_SIGNAL_FEED_AUTHOR_FILTER) return;
    if (authorFilterOptions.some((option) => option.value === authorFilter)) return;
    setAuthorFilter(ALL_SIGNAL_FEED_AUTHOR_FILTER);
  }, [authorFilter, authorFilterOptions]);

  const sortedAuthorFilterOptions = useMemo(
    () =>
      [...authorFilterOptions].sort((left, right) => {
        const leftFavorite = authorFavorites.has(left.value);
        const rightFavorite = authorFavorites.has(right.value);
        if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
        return 0;
      }),
    [authorFilterOptions, authorFavorites],
  );

  const selectedAuthorLabel =
    authorFilter === ALL_SIGNAL_FEED_AUTHOR_FILTER
      ? "全部博主 / 频道"
      : authorFilterOptions.find((option) => option.value === authorFilter)
          ?.label || "全部博主 / 频道";

  const favoriteAuthorCount = authorFilterOptions.reduce(
    (count, option) => count + (authorFavorites.has(option.value) ? 1 : 0),
    0,
  );

  const toggleAuthorFavorite = (value: string) => {
    setAuthorFavorites((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      writeSignalFeedAuthorFavorites(next);
      return next;
    });
  };

  const filteredFeed = useMemo(() => {
    const needle = deferredSearchQuery.trim().toLowerCase();
    const matching = unifiedFeed.filter((item) => {
      const matchesTab =
        matchesSignalFeedTab(item, activeTab);

      if (!matchesTab) {
        return false;
      }

      if (!matchesSignalFeedAuthorFilter(item, authorFilter)) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return (
        item.title.toLowerCase().includes(needle) ||
        item.text.toLowerCase().includes(needle) ||
        item.quotedTweet?.text.toLowerCase().includes(needle) === true
      );
    });
    return limitNewsItems(matching, feedLimitForTab(activeTab, feedRange));
  }, [unifiedFeed, activeTab, authorFilter, deferredSearchQuery, feedRange]);

  const deferredFeed = filteredFeed;

  const lastRefreshAtRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    let isActive = true;

    const refreshSources = async ({
      ignoreThrottle = false,
      replace = false,
    }: {
      ignoreThrottle?: boolean;
      replace?: boolean;
    } = {}) => {
      if (refreshInFlightRef.current) {
        return;
      }
      if (!ignoreThrottle && Date.now() - lastRefreshAtRef.current < 15000) {
        return;
      }
      refreshInFlightRef.current = true;
      lastRefreshAtRef.current = Date.now();
      let results: [
        PromiseSettledResult<TelegramDashboardSnapshot>,
        PromiseSettledResult<TwitterDashboardSnapshot> | null,
      ];
      try {
        const settled = await Promise.allSettled([
          requestTelegramSnapshot({ range: feedRange }),
          requestXSnapshot({ range: feedRange }),
        ]);
        results = [
          settled[0] as PromiseSettledResult<TelegramDashboardSnapshot>,
          settled[1] as PromiseSettledResult<TwitterDashboardSnapshot>,
        ];
      } finally {
        refreshInFlightRef.current = false;
      }

      if (!isActive) {
        return;
      }

      startTransition(() => {
        const [telegramResult, xResult] = results;
        if (telegramResult.status === "fulfilled") {
          setTelegramSnapshot((current) =>
            replace
              ? telegramResult.value
              : mergeTelegramSnapshot(
                  current,
                  telegramResult.value,
                  getSignalFeedRangeLimit(feedRange, "telegram"),
                ),
          );
        }
        if (xResult?.status === "fulfilled") {
          setXSnapshot((current) =>
            replace
              ? xResult.value
              : mergeTwitterSnapshot(
                  current,
                  xResult.value,
                  getSignalFeedRangeLimit(feedRange, "x"),
                ),
          );
        }
      });
    };

    const cleanups: Array<() => void> = [];

    const connectWithRetry = (
      url: string,
      setup: (source: EventSource) => void,
      onError: () => void,
    ): (() => void) => {
      let source: EventSource | null = null;
      let retryTimer: number | null = null;
      let retryCount = 0;
      let closed = false;

      const connect = () => {
        if (closed) return;
        const es = new EventSource(url);
        source = es;
        setup(es);
        es.onopen = () => {
          retryCount = 0;
        };
        es.onerror = () => {
          onError();
          if (closed) return;
          if (es.readyState !== EventSource.CLOSED) return;
          if (source === es) source = null;
          const delay = Math.min(30000, 1000 * 2 ** retryCount);
          retryCount += 1;
          retryTimer = window.setTimeout(connect, delay);
        };
      };

      connect();

      return () => {
        closed = true;
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        source?.close();
      };
    };

    if (
      !pollXSnapshot &&
      initialXSnapshot.status !== "paused"
    ) {
      const handleXSnapshot = (event: Event) => {
        const payload = parseEventPayload<TwitterDashboardSnapshot>(event);
        if (!payload) {
          return;
        }

        startTransition(() => {
          setXSnapshot((current) =>
            mergeTwitterSnapshot(
              current,
              payload,
              getSignalFeedRangeLimit(feedRange, "x"),
            ),
          );
        });
      };

      cleanups.push(
        connectWithRetry(
          "/api/x/events",
          (source) => {
            source.addEventListener("x-snapshot", handleXSnapshot);
          },
          () => {
            startTransition(() => {
              setXSnapshot((current) => ({
                ...current,
                isConnected: false,
                status:
                  current.status === "needs_token" || current.status === "paused"
                    ? current.status
                    : current.feed.length > 0
                      ? current.status
                      : "error",
              }));
            });
          },
        ),
      );
    }

    const handleTelegramSnapshot = (event: Event) => {
      const payload = parseEventPayload<TelegramDashboardSnapshot>(event);
      if (!payload) {
        return;
      }

      startTransition(() => {
        setTelegramSnapshot((current) =>
          mergeTelegramSnapshot(
            current,
            payload,
            getSignalFeedRangeLimit(feedRange, "telegram"),
          ),
        );
      });
    };

    cleanups.push(
      connectWithRetry(
        "/api/telegram/events",
        (source) => {
          source.addEventListener("telegram-snapshot", handleTelegramSnapshot);
        },
        () => {
          startTransition(() => {
            setTelegramSnapshot((current) => ({
              ...current,
              isConnected: false,
              status: current.feed.length > 0 ? current.status : "error",
            }));
          });
        },
      ),
    );

    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refreshSources();
      }
    }, SNAPSHOT_REFRESH_MS);

    const handleFocus = () => {
      void refreshSources();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSources();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void refreshSources({ ignoreThrottle: true, replace: true });
    return () => {
      isActive = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [
    initialXSnapshot.isConfigured,
    initialXSnapshot.status,
    feedRange,
    pollXSnapshot,
  ]);

  const mergedErrors = Array.from(
    new Set([
      ...telegramSnapshot.errors,
      ...xSnapshot.errors,
    ]),
  );

  const truthFeedCount = xSnapshot.feed.filter((item) =>
    isTruthUsername(item.username),
  ).length;
  const xFeedCount = xSnapshot.feed.filter((item) =>
    isMergedXSignalSource(classifyXFeedSource(item)),
  ).length;
  const tabs: Array<{
    id: Exclude<FeedTab, "all">;
    label: string;
    shortLabel: string;
    count: number;
  }> = [
    {
      id: "telegram",
      label: "Telegram",
      shortLabel: "TG",
      count: telegramSnapshot.feed.length,
    },
    { id: "x", label: "X", shortLabel: "X", count: xFeedCount },
    { id: "truth", label: "Truth", shortLabel: "TS", count: truthFeedCount },
  ];
  const telegramRefresh = telegramSnapshot.refresh;
  const telegramLastUpdatedAt =
    telegramRefresh?.finishedAt ||
    telegramRefresh?.cacheFetchedAt ||
    telegramRefresh?.servedAt;
  const telegramFirstError = telegramSnapshot.errors[0] || null;
  const xUsage = xSnapshot.usage;

  async function refreshTelegramNow() {
    setTelegramRefreshBusy(true);
    setTelegramManualStatus("TG 刷新中...");
    try {
      const snapshot = await requestTelegramSnapshot({ range: feedRange });
      startTransition(() => {
        setTelegramSnapshot((current) =>
          feedRange === DEFAULT_SIGNAL_FEED_RANGE
            ? mergeTelegramSnapshot(current, snapshot)
            : snapshot,
        );
      });
      const refreshedAt =
        snapshot.refresh?.finishedAt ||
        snapshot.refresh?.cacheFetchedAt ||
        snapshot.refresh?.servedAt ||
        new Date().toISOString();
      setTelegramManualStatus(
        `TG 已刷新：${formatStatusTime(refreshedAt)}，${snapshot.feed.length} 条`,
      );
    } catch (error) {
      setTelegramManualStatus(
        `TG 刷新失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTelegramRefreshBusy(false);
    }
  }

  async function authorizeXUsageToday() {
    setXUsageBusy(true);
    try {
      const response = await fetch("/api/x/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "authorize.today" }),
        cache: "no-store",
      });
      const payload = (await response.json()) as XUsageResponse;
      if (!response.ok || !payload.success || !payload.usage) {
        throw new Error(payload.error || `X usage authorization failed (${response.status})`);
      }
      startTransition(() => {
        setXSnapshot((current) => ({
          ...current,
          usage: payload.usage,
        }));
      });
    } finally {
      setXUsageBusy(false);
    }
  }

  async function refreshMonitor985Latest() {
    setMonitor985RefreshBusy(true);
    setXCatchupRunning(false);
    setXCatchupStatus("刷新 985 中...");
    try {
      const response = await fetch("/api/x/catchup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
        cache: "no-store",
      });
      const payload = (await response.json()) as Monitor985RefreshResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || `985 refresh failed (${response.status})`);
      }
      const snapshot = await requestXSnapshot({ range: feedRange });
      startTransition(() => {
        setXSnapshot((current) => {
          const merged =
            feedRange === DEFAULT_SIGNAL_FEED_RANGE
              ? mergeTwitterSnapshot(current, snapshot)
              : snapshot;
          return payload.usage
            ? {
                ...merged,
                usage: payload.usage,
              }
            : merged;
        });
      });
      const result = payload.result;
      setXCatchupStatus(
        result
          ? `985 刷新完成：接入 ${result.accepted}/${result.fetched} 条，忽略 ${result.ignored} 条，不扣 points`
          : "985 刷新完成，不扣 points",
      );
    } catch (error) {
      setXCatchupStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setMonitor985RefreshBusy(false);
    }
  }

  async function startXManualCatchup() {
    setXCatchupBusy(true);
    setXCatchupRunning(false);
    setXCatchupStatus(
      `6551 补漏中（${DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS}h）...`,
    );
    try {
      const response = await fetch("/api/x/hybrid-backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookbackHours: DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS,
          limit: 100,
          retryErrors: true,
          retryFallback: true,
          dryRun: false,
        }),
        cache: "no-store",
      });
      const payload = (await response.json()) as XBackfillResponse;
      if (!payload.success || !response.ok) {
        throw new Error(payload.error || `hybrid backfill failed (${response.status})`);
      }
      const snapshot = await requestXSnapshot({ range: feedRange });
      startTransition(() => {
        setXSnapshot((current) => {
          const merged =
            feedRange === DEFAULT_SIGNAL_FEED_RANGE
              ? mergeTwitterSnapshot(current, snapshot)
              : snapshot;
          return payload.usage
            ? {
                ...merged,
                usage: payload.usage,
              }
            : merged;
        });
      });
      setXCatchupRunning(false);
      setXCatchupStatus(formatXHybridBackfillStatus(payload));
    } catch (error) {
      setXCatchupRunning(false);
      setXCatchupStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setXCatchupBusy(false);
    }
  }

  useEffect(() => {
    if (!xCatchupRunning) return;
    let isActive = true;

    const refreshStatus = async () => {
      try {
        const response = await fetch("/api/x/catchup", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          success: boolean;
          running: boolean;
          health?: { detail: string } | null;
          usage?: NonNullable<TwitterDashboardSnapshot["usage"]>;
        };
        if (!isActive || !payload.success) return;

        startTransition(() => {
          if (payload.usage) {
            setXSnapshot((current) => ({
              ...current,
              usage: payload.usage,
            }));
          }
        });
        setXCatchupRunning(payload.running);
        setXCatchupStatus(
          payload.health?.detail ||
            (payload.running ? "985 最新流刷新中..." : "985 最新流已结束"),
        );

        if (!payload.running) {
          const snapshot = await requestXSnapshot({ range: feedRange });
          if (!isActive) return;
          startTransition(() => {
            setXSnapshot((current) =>
              feedRange === DEFAULT_SIGNAL_FEED_RANGE
                ? mergeTwitterSnapshot(current, snapshot)
                : snapshot,
            );
          });
        }
      } catch (error) {
        if (!isActive) return;
        setXCatchupStatus(error instanceof Error ? error.message : String(error));
      }
    };

    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 5000);

    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [xCatchupRunning, feedRange]);

  return (
    <section
      data-mobile-command-feed
      className={[
        "min-w-0 overflow-hidden rounded-lg border border-line/70 bg-panel/95 shadow-[0_24px_60px_-50px_rgba(0,0,0,0.65)]",
        rail
          ? "lg:sticky lg:top-[5.25rem] lg:flex lg:h-[calc(100vh-6rem)] lg:min-h-0 lg:flex-col"
          : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="shrink-0 border-b border-line/70 bg-panel-strong/95">
        <div className="px-3 py-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">Signal Flow</h2>
              <p className="mt-0.5 text-[11px] text-muted">
                {filteredFeed.length} / {unifiedFeed.length} 条信号
              </p>
            </div>

            <div className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-lg border border-line/70 bg-background/35 p-1 xl:w-[34rem] xl:overflow-visible">
              <button
                onClick={() => setActiveTab("all")}
                className={`relative min-w-[5.25rem] flex-1 shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors ${
                  activeTab === "all"
                    ? "bg-foreground text-background shadow-[0_12px_28px_-24px_rgba(38,31,27,0.65)]"
                    : "text-muted hover:bg-panel-strong/70 hover:text-foreground"
                }`}
              >
                全部
                {activeTab !== "all" && newCounts.all > 0 ? (
                  <span className="ml-1 inline-flex items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                    {newCounts.all > 99 ? "99+" : newCounts.all}
                  </span>
                ) : null}
              </button>
              {tabs.map((tab) => {
                const newCount =
                  tab.id === "telegram"
                    ? newCounts.telegram
                    : tab.id === "x"
                      ? newCounts.x
                      : newCounts.truth;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative min-w-[6.25rem] flex-1 shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors ${
                      activeTab === tab.id
                        ? "bg-foreground text-background shadow-[0_12px_28px_-24px_rgba(38,31,27,0.65)]"
                        : "text-muted hover:bg-panel-strong/70 hover:text-foreground"
                    }`}
                  >
                    <span className="sm:hidden">{tab.shortLabel}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="ml-1 opacity-50">{tab.count}</span>
                    {activeTab !== tab.id && newCount > 0 ? (
                      <span className="ml-1 inline-flex items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {newCount > 99 ? "99+" : newCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-5 gap-1 rounded-lg border border-line/70 bg-background/35 p-1">
            {SIGNAL_FEED_RANGE_OPTIONS.map((option) => {
              const selected = option.id === feedRange;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFeedRange(option.id)}
                  className={`h-8 rounded-md px-2 text-[11px] font-semibold transition-colors ${
                    selected
                      ? "bg-foreground text-background shadow-[0_12px_28px_-24px_rgba(38,31,27,0.65)]"
                      : "text-muted hover:bg-panel-strong/70 hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)]">
            <input
              type="text"
              placeholder="搜索关键词..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-line/70 bg-background/55 px-3 text-xs text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
            <div ref={authorMenuRef} className="relative">
              <button
                type="button"
                aria-label="按博主或频道筛选"
                aria-expanded={authorMenuOpen}
                onClick={() => setAuthorMenuOpen((open) => !open)}
                className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line/70 bg-background/55 px-3 text-left text-xs font-medium text-foreground transition-colors hover:bg-panel-strong/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
              >
                <span className="min-w-0 truncate">{selectedAuthorLabel}</span>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted">
                  {favoriteAuthorCount > 0 ? (
                    <span className="rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent">
                      ★ {favoriteAuthorCount}
                    </span>
                  ) : null}
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${
                      authorMenuOpen ? "rotate-180" : ""
                    }`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>

              {authorMenuOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.35rem)] z-30 max-h-80 w-full overflow-y-auto rounded-lg border border-line/70 bg-panel-strong p-1 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.85)]">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthorFilter(ALL_SIGNAL_FEED_AUTHOR_FILTER);
                      setAuthorMenuOpen(false);
                    }}
                    className={`flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs font-semibold transition-colors ${
                      authorFilter === ALL_SIGNAL_FEED_AUTHOR_FILTER
                        ? "bg-foreground text-background"
                        : "text-muted hover:bg-background/70 hover:text-foreground"
                    }`}
                  >
                    <span>全部博主 / 频道</span>
                    <span>{authorFilterOptions.length}</span>
                  </button>
                  {favoriteAuthorCount > 0 ? (
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent/80">
                      收藏优先显示
                    </div>
                  ) : null}
                  {sortedAuthorFilterOptions.length > 0 ? (
                    sortedAuthorFilterOptions.map((option) => {
                      const isActive = option.value === authorFilter;
                      const isFavorite = authorFavorites.has(option.value);
                      return (
                        <div
                          key={option.value}
                          className={`group/author flex items-center gap-1 rounded-md ${
                            isActive ? "bg-background/80" : "hover:bg-background/55"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setAuthorFilter(option.value);
                              setAuthorMenuOpen(false);
                            }}
                            className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 px-2 text-left text-xs"
                          >
                            <span
                              className={`min-w-0 truncate ${
                                isActive
                                  ? "font-semibold text-foreground"
                                  : "text-muted group-hover/author:text-foreground"
                              }`}
                            >
                              {option.label}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted">
                              {option.count}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={`${isFavorite ? "取消收藏" : "收藏"} ${option.label}`}
                            aria-pressed={isFavorite}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleAuthorFavorite(option.value);
                            }}
                            className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                              isFavorite
                                ? "text-accent hover:bg-accent/10"
                                : "text-muted/60 hover:bg-background/80 hover:text-accent"
                            }`}
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              viewBox="0 0 24 24"
                              fill={isFavorite ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="m12 3.6 2.5 5.1 5.6.8-4 3.9.9 5.5-5-2.7-5 2.7.9-5.5-4-3.9 5.6-.8L12 3.6Z" />
                            </svg>
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-2 py-3 text-center text-xs text-muted">
                      暂无博主 / 频道
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-t border-line/40 px-3 py-2 text-[11px] text-muted">
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
            <span
              className={`inline-flex items-center gap-1 rounded-md border border-line/60 bg-panel-strong px-2 py-1 font-medium ${
                telegramSnapshot.status === "live"
                  ? "text-success"
                  : telegramSnapshot.status === "error"
                    ? "text-danger"
                    : "text-warning"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              TG {telegramSnapshot.status}
            </span>
            <span className="rounded-md border border-line/60 bg-panel-strong px-2 py-1">更新 {formatStatusTime(telegramLastUpdatedAt)}</span>
            <button
              type="button"
              disabled={telegramRefreshBusy}
              onClick={() => void refreshTelegramNow()}
              className="order-[-10] rounded-md border border-line/70 bg-panel-strong px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-panel hover:text-foreground disabled:opacity-60"
            >
              {telegramRefreshBusy ? "TG 刷新中..." : "刷新 TG"}
            </button>
            {telegramManualStatus ? (
              <span
                className={`max-w-[16rem] truncate ${
                  telegramManualStatus.includes("失败") ||
                  telegramManualStatus.toLowerCase().includes("failed") ||
                  telegramManualStatus.toLowerCase().includes("error")
                    ? "text-danger"
                    : "text-muted"
                }`}
              >
                {telegramManualStatus}
              </span>
            ) : null}
            {xUsage ? (
              <>
                <span
                  className={`inline-flex items-center gap-1 rounded-md border border-line/60 bg-panel-strong px-2 py-1 font-medium ${
                    xUsage.blocked
                      ? "text-danger"
                      : xUsage.pointsUsed >= xUsage.limit
                        ? "text-warning"
                        : "text-muted"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  X points {xUsage.pointsUsed}/{xUsage.limit}
                </span>
                {xUsage.authorized ? (
                  <span className="rounded-md border border-success/30 bg-success-soft px-2 py-1 text-success">X authorized today</span>
                ) : null}
                {xUsage.blocked ? (
                  <button
                    type="button"
                    disabled={xUsageBusy}
                    onClick={() => void authorizeXUsageToday()}
                    className="rounded-md border border-danger/50 px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
                  >
                    {xUsageBusy ? "Authorizing..." : "Authorize X today"}
                  </button>
                ) : null}
              </>
            ) : null}
            {!pollXSnapshot && xSnapshot.isConfigured ? (
              <>
                <button
                  type="button"
                  disabled={monitor985RefreshBusy || xCatchupBusy || xCatchupRunning}
                  onClick={() => void refreshMonitor985Latest()}
                  className="order-[-30] rounded-md border border-accent/35 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-60"
                >
                  {monitor985RefreshBusy ? "刷新中..." : "刷新 985"}
                </button>
                <button
                  type="button"
                  disabled={monitor985RefreshBusy || xCatchupBusy || xCatchupRunning}
                  onClick={() => void startXManualCatchup()}
                  className="order-[-20] rounded-md border border-line/70 bg-panel-strong px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-panel hover:text-foreground disabled:opacity-60"
                >
                  {xCatchupRunning || xCatchupBusy ? "补漏中..." : "6551 补漏"}
                </button>
              </>
            ) : null}
            {xCatchupStatus ? (
              <span
                className={`max-w-[16rem] truncate ${
                  xCatchupStatus.toLowerCase().includes("error") ||
                  xCatchupStatus.includes("failed") ||
                  xCatchupStatus.includes("失败")
                    ? "text-danger"
                    : "text-muted"
                }`}
              >
                {xCatchupStatus}
              </span>
            ) : null}
            {telegramFirstError ? (
              <span className="max-w-[18rem] truncate text-danger">
                {telegramFirstError}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {telegramFirstError ? (
        <div
          data-telegram-fault-alert
          className="border-b border-danger/30 bg-danger-soft/35 px-3 py-2"
        >
          <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs font-medium leading-5 text-danger">
            <span className="font-semibold">TG 采集异常</span>
            <span className="ml-2">{telegramFirstError}</span>
          </p>
        </div>
      ) : null}

      {/* Timeline */}
      <div
        className={`min-h-0 space-y-2.5 bg-background/70 p-2 sm:p-3 ${
          rail ? "lg:flex-1 lg:overflow-y-auto lg:overscroll-contain" : ""
        }`}
      >
        {deferredFeed.length > 0 ? (
          deferredFeed.map((item) => {
            const mediaViewport = getMediaViewport(item.media);
            const isRead = readItems.has(item.id);
            const icon = SOURCE_ICON[item.source] || SOURCE_ICON.alert;
            const sourceBadge = getXSourceBadge(item.source);
            const copyText = item.translation?.text
              ? `${item.text}\n\n${item.translation.text}`
              : item.text;
            const quotedCopyText = item.quotedTweet?.text
              ? `\n\n引用 ${item.quotedTweet.title}: ${item.quotedTweet.text}`
              : "";
            const quoteMediaViewport = getMediaViewport(item.quotedTweet?.media ?? null);

            return (
              <article
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (window.getSelection()?.toString()) return;
                  setReadItems((current) => {
                    const next = new Set(current);
                    next.add(item.id);
                    return next;
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setReadItems((current) => {
                      const next = new Set(current);
                      next.add(item.id);
                      return next;
                    });
                  }
                }}
                className="group relative grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-2.5 rounded-lg border border-line/70 border-l-2 border-l-accent/45 bg-panel-strong/92 px-3 py-3.5 shadow-[0_16px_34px_-30px_rgba(0,0,0,0.75)] transition-all active:scale-[0.995] hover:border-accent/45 hover:bg-panel-strong focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {/* Avatar */}
                <div className="relative shrink-0 pt-0.5">
                  {item.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.avatar}
                      alt={item.title}
                      width={36}
                      height={36}
                      loading="lazy"
                      decoding="async"
                      className="h-8 w-8 rounded-lg bg-panel-strong object-cover ring-1 ring-line/55"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div
                    className={`h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ring-1 ring-line/30 ${icon.tone} ${item.avatar ? "hidden" : "flex"}`}
                  >
                    {icon.letter}
                  </div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  {/* Header line */}
                  <div className="flex items-center gap-1.5 text-[13px] leading-5">
                    {item.titleUrl === "#" ? (
                      <span className="truncate font-semibold text-foreground">{item.title}</span>
                    ) : (
                      <a href={item.titleUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate font-semibold text-foreground hover:underline">
                        {item.title}
                      </a>
                    )}
                    {sourceBadge ? (
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${sourceBadge.className}`}
                      >
                        {sourceBadge.label}
                      </span>
                    ) : null}
                    {item.subtitle ? (
                      <span className="truncate text-muted">{item.subtitle}</span>
                    ) : null}
                    <span className="text-muted">·</span>
                    <span className="shrink-0 text-muted">{formatDisplayTime(item.createdAt)}</span>
                    {!isRead && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]" />}
                  </div>

                  {/* Body */}
                  <p className="selectable-text mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-5 text-foreground">
                    {renderTextWithLinks(item.text)}
                  </p>

                  {/* Translation */}
                  {item.translation ? (
                    <div className="mt-2 rounded-lg border border-info/20 bg-info-soft/45 px-2.5 py-2">
                      <p className="text-[11px] font-medium text-muted">
                        {formatLanguageTag(item.translation.sourceLanguage)} → {item.translation.targetLanguage}
                      </p>
                      <p className="selectable-text mt-1 whitespace-pre-wrap break-words text-[14px] leading-5 text-foreground">
                        {renderTextWithLinks(item.translation.text)}
                      </p>
                    </div>
                  ) : null}

                  {/* Quoted tweet */}
                  {item.quotedTweet ? (
                    <div className="mt-2.5 rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-5">
                        <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md bg-panel-strong ring-1 ring-accent/25">
                          {item.quotedTweet.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.quotedTweet.avatar}
                              alt={item.quotedTweet.title}
                              width={28}
                              height={28}
                              loading="lazy"
                              decoding="async"
                              className="h-7 w-7 object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                                const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                                if (fallback) fallback.style.display = "flex";
                              }}
                            />
                          ) : null}
                          <div
                            className={`h-7 w-7 items-center justify-center text-[10px] font-bold text-muted ${item.quotedTweet.avatar ? "hidden" : "flex"}`}
                          >
                            RT
                          </div>
                        </div>
                        <span className="shrink-0 rounded-md border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          {item.quotedTweet.relation === "reply"
                            ? "回复上文"
                            : "引用/转发"}
                        </span>
                        {item.quotedTweet.titleUrl !== "#" ? (
                          <a
                            href={item.quotedTweet.titleUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="min-w-0 truncate font-semibold text-foreground hover:underline"
                          >
                            {item.quotedTweet.title}
                          </a>
                        ) : (
                          <span className="min-w-0 truncate font-semibold text-foreground">
                            {item.quotedTweet.title}
                          </span>
                        )}
                        {item.quotedTweet.subtitle ? (
                          <span className="min-w-0 truncate text-muted">
                            {item.quotedTweet.subtitle}
                          </span>
                        ) : null}
                        {item.quotedTweet.createdAt ? (
                          <>
                            <span className="text-muted">·</span>
                            <span className="shrink-0 text-muted">
                              {formatDisplayTime(item.quotedTweet.createdAt)}
                            </span>
                          </>
                        ) : null}
                        {item.quotedTweet.link !== "#" ? (
                          <a
                            href={item.quotedTweet.link}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto shrink-0 text-[11px] text-muted hover:text-accent"
                          >
                            原文
                          </a>
                        ) : null}
                      </div>
                      {item.quotedTweet.text ? (
                        <p className="selectable-text mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
                          {renderTextWithLinks(item.quotedTweet.text)}
                        </p>
                      ) : (
                        <p className="mt-1 text-[13px] leading-5 text-muted">
                          引用推文正在补全...
                        </p>
                      )}
                      {item.quotedTweet.translation ? (
                        <div className="mt-2 rounded-md border border-info/20 bg-info-soft/40 px-2 py-1.5">
                          <p className="text-[11px] font-medium text-muted">
                            {formatLanguageTag(item.quotedTweet.translation.sourceLanguage)} → {item.quotedTweet.translation.targetLanguage}
                          </p>
                          <p className="selectable-text mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
                            {renderTextWithLinks(item.quotedTweet.translation.text)}
                          </p>
                        </div>
                      ) : null}
                      {item.quotedTweet.media ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxMedia(item.quotedTweet?.media ?? null);
                          }}
                          className="mt-2 block w-full overflow-hidden rounded-md border border-line/50 bg-panel/40 text-left"
                          aria-label={`查看${item.quotedTweet.media.label || "图片"}大图`}
                        >
                          <Image
                            src={item.quotedTweet.media.previewUrl}
                            alt={item.quotedTweet.media.label}
                            width={quoteMediaViewport.width}
                            height={quoteMediaViewport.height}
                            unoptimized
                            className="block h-auto w-full cursor-zoom-in object-contain transition-opacity hover:opacity-95 max-h-[12rem]"
                          />
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Media */}
                  {item.media ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxMedia(item.media);
                      }}
                      className="mt-2.5 block w-full overflow-hidden rounded-lg border border-line/50 bg-background/35 text-left"
                      aria-label={`查看${item.media.label || "图片"}大图`}
                    >
                      <Image
                        src={item.media.previewUrl}
                        alt={item.media.label}
                        width={mediaViewport.width}
                        height={mediaViewport.height}
                        unoptimized
                        className={`block h-auto w-full cursor-zoom-in object-contain transition-opacity hover:opacity-95 ${
                          rail ? "max-h-[14rem]" : "max-h-[20rem]"
                        }`}
                      />
                    </button>
                  ) : null}

                  {/* Chips row */}
                  {(item.chips.length > 0 || item.metrics.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.chips.map((chip) => (
                        <span key={`${item.id}-${chip}`} className="text-xs font-medium text-accent">
                          {chip}
                        </span>
                      ))}
                      {item.metrics.map((metric) => (
                        <span key={`${item.id}-${metric}`} className="text-xs text-muted">
                          {metric}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex max-w-[230px] items-center justify-between text-muted">
                    <CopyButton text={`${copyText}${quotedCopyText}`} />

                    {item.link !== "#" ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs transition-colors hover:text-accent"
                        aria-label={item.linkLabel}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    ) : null}

                    {isMergedXSignalSource(item.source) ? null : (
                      <span className="text-[11px] uppercase opacity-50">
                        {item.sourceLabel}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">没有匹配的消息</p>
            <p className="mt-1 text-xs text-muted">尝试调整筛选条件或关键词搜索。</p>
          </div>
        )}
      </div>

      {/* Errors */}
      {mergedErrors.length > 0 ? (
        <div className="border-t border-line/50 px-4 py-3 space-y-1.5">
          {mergedErrors.map((error) => (
            <p key={error} className="text-xs leading-5 text-danger">{error}</p>
          ))}
        </div>
      ) : null}

      {/* Image lightbox */}
      {portalRoot && lightboxMedia
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="图片预览"
              onClick={() => setLightboxMedia(null)}
              className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxMedia(null);
                }}
                aria-label="关闭预览"
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxMedia.previewUrl}
                alt={lightboxMedia.label}
                onClick={(e) => e.stopPropagation()}
                className="max-h-[92vh] max-w-[92vw] cursor-default rounded-lg bg-white object-contain shadow-2xl"
              />
            </div>,
            portalRoot,
          )
        : null}
    </section>
  );
}
