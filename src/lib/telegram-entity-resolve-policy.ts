const DEFAULT_ENTITY_RESOLVE_TIMEOUT_MS = 25_000;
const DEFAULT_ENTITY_RESOLVE_CONCURRENCY = 4;
const MAX_ENTITY_RESOLVE_CONCURRENCY = 8;

function parsePositiveInteger(raw: string | undefined): number | null {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseTelegramEntityResolveTimeoutMs(
  raw: string | undefined,
): number {
  return parsePositiveInteger(raw) ?? DEFAULT_ENTITY_RESOLVE_TIMEOUT_MS;
}

export function parseTelegramEntityResolveConcurrency(
  raw: string | undefined,
): number {
  const parsed = parsePositiveInteger(raw);
  if (!parsed) {
    return DEFAULT_ENTITY_RESOLVE_CONCURRENCY;
  }

  return Math.min(parsed, MAX_ENTITY_RESOLVE_CONCURRENCY);
}
