import type { TelegramDashboardSnapshot } from "@/lib/telegram-channels";

export function chooseTelegramRefreshResult(
  fresh: TelegramDashboardSnapshot,
  cached: TelegramDashboardSnapshot | null,
): TelegramDashboardSnapshot {
  if (fresh.status !== "error" && fresh.feed.length > 0) {
    return fresh;
  }

  if (!cached || cached.feed.length === 0) {
    return fresh;
  }

  return {
    ...cached,
    isConnected: false,
    status: "limited",
    note: `${cached.note} 最近一次刷新失败，当前显示缓存内容。`,
    errors:
      fresh.errors.length > 0
        ? fresh.errors
        : ["Telegram 刷新失败，当前显示缓存内容。"],
  };
}
