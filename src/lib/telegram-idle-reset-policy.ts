export const DEFAULT_TELEGRAM_IDLE_RESET_MS = 0;

export function parseTelegramIdleResetMs(raw: string | undefined) {
  const value = raw?.trim().toLowerCase();
  if (!value || value === "0" || value === "off" || value === "false") {
    return DEFAULT_TELEGRAM_IDLE_RESET_MS;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TELEGRAM_IDLE_RESET_MS;
}
