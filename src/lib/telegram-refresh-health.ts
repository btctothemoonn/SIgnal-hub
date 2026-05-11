import type { TelegramDashboardSnapshot } from "@/lib/telegram-channels";

export function shouldResetTelegramClientAfterSnapshot(
  snapshot: TelegramDashboardSnapshot,
): boolean {
  if (!snapshot.isConfigured || snapshot.status === "needs_config") {
    return false;
  }

  if (snapshot.status === "error") {
    return true;
  }

  return snapshot.errors.length > 0 && snapshot.channels.length === 0;
}
