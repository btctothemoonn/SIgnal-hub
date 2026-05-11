import type { TelegramDashboardSnapshot } from "@/lib/telegram-channels";

const DEFAULT_CLIENT_FEED_LIMIT = 100;
const DEFAULT_CLIENT_MEDIA_LIMIT = 24;

type PrepareOptions = {
  feedLimit?: number;
  mediaLimit?: number;
};

export function prepareTelegramSnapshotForClient(
  snapshot: TelegramDashboardSnapshot,
  options: PrepareOptions = {},
): TelegramDashboardSnapshot {
  const feedLimit = options.feedLimit ?? DEFAULT_CLIENT_FEED_LIMIT;
  const mediaLimit = options.mediaLimit ?? DEFAULT_CLIENT_MEDIA_LIMIT;

  return {
    ...snapshot,
    feed: snapshot.feed.slice(0, feedLimit).map((item, index) =>
      index < mediaLimit
        ? item
        : {
            ...item,
            media: null,
          },
    ),
  };
}
