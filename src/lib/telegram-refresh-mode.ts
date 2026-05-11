export function shouldWaitForTelegramRefresh(url: string) {
  const parsed = new URL(url);
  const value = parsed.searchParams.get("refresh")?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
