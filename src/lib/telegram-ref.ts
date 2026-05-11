const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "www.t.me", "www.telegram.me"]);

function normalizePlainRef(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, "")
    .replace(/^\/+/, "")
    .split(/[/?#]/, 1)[0]
    .trim()
    .toLowerCase();
}

export function normalizeTelegramRefKey(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return "";

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^@+/, "")}`;

  try {
    const url = new URL(candidate);
    if (TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) {
      return normalizePlainRef(url.pathname);
    }
  } catch {
    return normalizePlainRef(trimmed);
  }

  return normalizePlainRef(trimmed);
}
