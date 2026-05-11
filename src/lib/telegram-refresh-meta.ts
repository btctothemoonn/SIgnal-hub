import type {
  TelegramDashboardSnapshot,
  TelegramRefreshMeta,
} from "@/lib/telegram-channels";

type RefreshMetaInput = {
  source: TelegramRefreshMeta["source"];
  servedAtMs?: number;
  startedAtMs?: number | null;
  finishedAtMs?: number | null;
  cacheFetchedAtMs?: number | null;
};

function toIso(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : null;
}

export function withTelegramRefreshMeta(
  snapshot: TelegramDashboardSnapshot,
  input: RefreshMetaInput,
): TelegramDashboardSnapshot {
  const startedAt = toIso(input.startedAtMs);
  const finishedAt = toIso(input.finishedAtMs);
  const cacheFetchedAt = toIso(input.cacheFetchedAtMs);
  const durationMs =
    typeof input.startedAtMs === "number" &&
    typeof input.finishedAtMs === "number" &&
    Number.isFinite(input.startedAtMs) &&
    Number.isFinite(input.finishedAtMs)
      ? Math.max(0, input.finishedAtMs - input.startedAtMs)
      : null;

  return {
    ...snapshot,
    refresh: {
      source: input.source,
      servedAt: new Date(input.servedAtMs ?? Date.now()).toISOString(),
      startedAt,
      finishedAt,
      durationMs,
      cacheFetchedAt,
    },
  };
}

export function formatTelegramRefreshDuration(durationMs: number | null | undefined) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return "n/a";
  }

  return `${(Math.round(durationMs / 100) / 10).toFixed(1)}s`;
}
