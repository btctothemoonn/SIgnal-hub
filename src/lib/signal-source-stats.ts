import { classifyXFeedSource } from "./x-feed-source.ts";

type MinimalTelegramSnapshot = {
  channels?: unknown[];
  feed?: unknown[];
  status?: string;
};

type MinimalXFeedItem = {
  username?: string;
  queryLabel?: string;
};

type MinimalXSnapshot = {
  feed?: MinimalXFeedItem[];
  status?: string;
};

export type SignalSourceStats = {
  telegramChannels: number;
  telegramItems: number;
  xItems: number;
  monitor985Items: number;
  truthItems: number;
  telegramStatus: string;
  xStatus: string;
  truthStatus: string;
};

function normalizeStatus(status: string | undefined, hasItems = true): string {
  if (status === "live") return "在线";
  if (!status && hasItems) return "在线";
  return status || "离线";
}

export function buildSignalSourceStats(input: {
  telegram: MinimalTelegramSnapshot;
  x: MinimalXSnapshot;
}): SignalSourceStats {
  const xFeed = Array.isArray(input.x.feed) ? input.x.feed : [];
  const sourceCounts = xFeed.reduce(
    (counts, item) => {
      counts[classifyXFeedSource(item)] += 1;
      return counts;
    },
    { x: 0, monitor985: 0, truth: 0 },
  );

  return {
    telegramChannels: Array.isArray(input.telegram.channels)
      ? input.telegram.channels.length
      : 0,
    telegramItems: Array.isArray(input.telegram.feed)
      ? input.telegram.feed.length
      : 0,
    xItems: sourceCounts.x,
    monitor985Items: sourceCounts.monitor985,
    truthItems: sourceCounts.truth,
    telegramStatus: normalizeStatus(input.telegram.status, true),
    xStatus: normalizeStatus(input.x.status, sourceCounts.x > 0),
    truthStatus: sourceCounts.truth > 0 ? "在线" : "待信号",
  };
}
