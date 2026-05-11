import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import { get6551TwitterTweetById } from "@/lib/6551-twitter";
import { getTelegramPipelineConfig } from "@/lib/telegram-pipeline-config";
import {
  getTelegramXSourceChannelKeys,
  isTelegramXSourceChannel,
} from "@/lib/telegram-x-source-channels";
import { reserveXApiPoints, getXApiUsageSnapshot } from "@/lib/x-api-usage";
import {
  DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS,
  resolveXHybridBackfillLookbackHours,
  resolveXHybridBackfillLookbackMs,
} from "@/lib/x-hybrid-backfill-options";
import {
  parseXHybridTelegramCandidate,
  shouldProcessXHybridSourceStatus,
} from "@/lib/x-hybrid-telegram";
import { runMonitor985ManualCatchup } from "@/lib/monitor985-catchup";
import { confirmXHybridPrimaryMisses } from "@/lib/x-hybrid-primary-refresh";
import { getXPipelineConfig } from "@/lib/x-pipeline-config";
import {
  getXHybridSourceStatus,
  getXPipelineHealth,
  getXPipelineFeedItem,
  getXPipelineQuotedTweet,
  markXHybridSource,
  setXPipelineHealth,
  upsertXPipelineQuotedTweet,
  upsertXPipelineRealtimeUpdate,
} from "@/lib/x-pipeline-store";
import { resolveHybridQuotedTweet } from "@/lib/x-hybrid-quoted-tweet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramRow = {
  channel_ref: string;
  channel_title: string;
  channel_username: string;
  channel_id: string;
  message_id: number;
  message_url: string;
  text: string;
  created_at: string;
  raw_json: string;
};

type RequestBody = {
  lookbackHours?: number;
  scanLimit?: number;
  limit?: number;
  retryErrors?: boolean;
  retryFallback?: boolean;
  dryRun?: boolean;
};

function positiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function accountKey(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function parseJsonObject(raw: string) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sourceId(row: TelegramRow) {
  return `telegram:${row.channel_id}:${row.message_id}`;
}

function shouldProcessSourceStatus({
  status,
  retryErrors,
  retryFallback,
  candidateTweetId,
}: {
  status: ReturnType<typeof getXHybridSourceStatus>;
  retryErrors: boolean;
  retryFallback: boolean;
  candidateTweetId?: string | null;
}) {
  if (
    shouldProcessXHybridSourceStatus(status, {
      retryErrors,
      candidateTweetId,
    })
  ) {
    return true;
  }
  return (
    retryFallback &&
    status?.status === "fallback" &&
    /fetch failed|network|6551/i.test(status.detail)
  );
}

async function readBody(request: Request): Promise<RequestBody> {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    return {
      lookbackHours: resolveXHybridBackfillLookbackHours(raw),
      scanLimit: positiveInt(raw.scanLimit, 1000),
      limit: positiveInt(raw.limit, 100),
      retryErrors: boolValue(raw.retryErrors, true),
      retryFallback: boolValue(raw.retryFallback, true),
      dryRun: boolValue(raw.dryRun, false),
    };
  } catch {
    return {
      lookbackHours: DEFAULT_X_HYBRID_BACKFILL_LOOKBACK_HOURS,
      scanLimit: 1000,
      limit: 100,
      retryErrors: true,
      retryFallback: true,
      dryRun: false,
    };
  }
}

function recentTelegramSourceRows({
  cutoffIso,
  scanLimit,
}: {
  cutoffIso: string;
  scanLimit: number;
}) {
  const keys = getTelegramXSourceChannelKeys();
  const db = new DatabaseSync(getTelegramPipelineConfig().dbPath);
  try {
    const rows = db
      .prepare(
        `
        select channel_ref, channel_title, channel_username, channel_id,
          message_id, message_url, text, created_at, raw_json
        from telegram_messages
        where created_at >= ?
        order by created_at asc, message_id asc
        limit ?
      `,
      )
      .all(cutoffIso, scanLimit) as TelegramRow[];
    return rows.filter((row) =>
      isTelegramXSourceChannel(
        {
          ref: row.channel_ref,
          username: row.channel_username,
          channelId: row.channel_id,
          title: row.channel_title,
        },
        keys,
      ),
    );
  } finally {
    db.close();
  }
}

function enabledAccountKeys() {
  const db = new DatabaseSync(getXPipelineConfig().dbPath);
  try {
    return new Set(
      db
        .prepare("select username_key from x_accounts where enabled = 1")
        .all()
        .map((row) => String((row as Record<string, unknown>).username_key)),
    );
  } finally {
    db.close();
  }
}

export async function POST(request: Request) {
  const input = await readBody(request);
  const lookbackHours = resolveXHybridBackfillLookbackHours(input);
  const lookbackMs = resolveXHybridBackfillLookbackMs(input);
  const graceMs = positiveInt(process.env.X_HYBRID_985_GRACE_MS, 5 * 60_000);
  const cutoffIso = new Date(Date.now() - lookbackMs).toISOString();
  const rows = recentTelegramSourceRows({
    cutoffIso,
    scanLimit: positiveInt(input.scanLimit, 1000),
  });
  const allowed = enabledAccountKeys();
  const stats = {
    lookbackHours,
    checked: rows.length,
    parsed: 0,
    skippedNoTweetId: 0,
    skippedNotConfigured: 0,
    skippedAlreadyProcessed: 0,
    skippedAlreadyIn985: 0,
    pendingGrace: 0,
    selected: 0,
    enriched: 0,
    failed: 0,
    pointsReserved: 0,
    quotedResolved: 0,
    quotedPointsReserved: 0,
    primaryRefreshes: 0,
    primaryRefreshFailed: 0,
    skippedAfter985Refresh: 0,
    dryRun: Boolean(input.dryRun),
    samples: [] as Array<{
      username: string | null;
      tweetId: string | null;
      status: string;
      detail: string;
    }>,
  };

  setXPipelineHealth({
    scope: "hybrid",
    status: "connecting",
    detail: `hybrid backfill checking ${rows.length} Telegram trigger messages`,
  });
  const candidates: Array<{
    item: {
      sourceId: string;
      candidate: NonNullable<ReturnType<typeof parseXHybridTelegramCandidate>>;
    };
    tweetId: string;
    sourceCreatedAt: string;
  }> = [];

  for (const row of rows) {
    const id = sourceId(row);
    const candidate = parseXHybridTelegramCandidate({
      sourceId: id,
      messageUrl: row.message_url,
      text: row.text,
      createdAt: row.created_at,
      raw: parseJsonObject(row.raw_json),
    });
    if (!candidate) continue;
    stats.parsed += 1;
    const status = getXHybridSourceStatus(id);
    if (
      !shouldProcessSourceStatus({
        status,
        retryErrors: Boolean(input.retryErrors),
        retryFallback: Boolean(input.retryFallback),
        candidateTweetId: candidate.tweetId,
      })
    ) {
      stats.skippedAlreadyProcessed += 1;
      continue;
    }
    if (!candidate.tweetId) {
      stats.skippedNoTweetId += 1;
      continue;
    }
    if (!allowed.has(accountKey(candidate.username))) {
      stats.skippedNotConfigured += 1;
      markXHybridSource({
        sourceId: id,
        status: "ignored",
        detail: `x account not configured: @${candidate.username || "unknown"}`,
        tweetId: candidate.tweetId,
      });
      continue;
    }

    candidates.push({
      item: { sourceId: id, candidate },
      tweetId: candidate.tweetId,
      sourceCreatedAt: candidate.createdAt,
    });
  }

  const primaryCheckedAt = getXPipelineHealth("collector")?.updatedAt ?? null;
  const confirmation = await confirmXHybridPrimaryMisses({
    candidates,
    primaryCheckedAt,
    delayMs: graceMs,
    getExistingTweet: getXPipelineFeedItem,
    refreshPrimary: async () => {
      if (stats.dryRun) {
        return {
          checkedAt: primaryCheckedAt,
          detail: "dry-run skipped 985 primary refresh",
        };
      }
      stats.primaryRefreshes += 1;
      const result = await runMonitor985ManualCatchup({
        input: {
          limit: positiveInt(process.env.MONITOR985_HYBRID_PREFLIGHT_LIMIT, 100),
        },
      });
      return {
        checkedAt: getXPipelineHealth("collector")?.updatedAt ?? null,
        detail: result.detail,
      };
    },
  });

  if (confirmation.refreshFailed) {
    stats.primaryRefreshFailed += 1;
  }
  if (confirmation.refreshAttempted && !stats.dryRun) {
    stats.skippedAfter985Refresh = confirmation.skippedExisting.length;
  }

  for (const skipped of confirmation.skippedExisting) {
    stats.skippedAlreadyIn985 += 1;
    markXHybridSource({
      sourceId: skipped.item.sourceId,
      status: "ignored",
      detail: confirmation.refreshAttempted
        ? "tweet present after 985 primary refresh; skipped 6551 fallback"
        : "tweet already present before 6551 fallback",
      tweetId: skipped.tweetId,
    });
  }

  for (const pending of confirmation.pending) {
    stats.pendingGrace += 1;
    markXHybridSource({
      sourceId: pending.candidate.item.sourceId,
      status: "pending",
      detail: pending.detail,
      tweetId: pending.candidate.tweetId,
    });
  }

  for (const ready of confirmation.ready.slice(0, positiveInt(input.limit, 100))) {
    const candidate = ready.item.candidate;
    const tweetId = ready.tweetId;
    stats.selected += 1;
    if (stats.dryRun) {
      stats.samples.push({
        username: candidate.username,
        tweetId,
        status: "dry-run",
        detail: "would call 6551 tweet_by_id after 985 preflight",
      });
      continue;
    }

    const reservation = reserveXApiPoints({
      kind: "tweet_by_id",
      detail: `hybrid-backfill ${tweetId}`,
    });
    if (!reservation.allowed) {
      markXHybridSource({
        sourceId: ready.item.sourceId,
        status: "pending",
        detail: `${reservation.reason}; authorization required`,
        tweetId,
      });
      break;
    }
    stats.pointsReserved += reservation.points;

    try {
      const tweet = await get6551TwitterTweetById(tweetId);
      if (!tweet) {
        stats.failed += 1;
        markXHybridSource({
          sourceId: ready.item.sourceId,
          status: "fallback",
          detail: `tweet-id fetch returned empty for ${tweetId}`,
          tweetId,
        });
        continue;
      }
      const quotedResult = await resolveHybridQuotedTweet(tweet, {
        getFeedItem: getXPipelineFeedItem,
        getQuotedTweet: getXPipelineQuotedTweet,
        saveQuotedTweet: upsertXPipelineQuotedTweet,
        reservePoints: (tweetId) =>
          reserveXApiPoints({
            kind: "tweet_by_id",
            detail: `hybrid-backfill quoted-tweet ${tweetId}`,
          }),
        fetchTweetById: get6551TwitterTweetById,
      });
      stats.quotedPointsReserved += quotedResult.pointsReserved;
      stats.pointsReserved += quotedResult.pointsReserved;
      if (
        quotedResult.status === "complete" ||
        quotedResult.status === "cached" ||
        quotedResult.status === "fetched"
      ) {
        stats.quotedResolved += 1;
      }

      const feedItem = {
        ...quotedResult.feedItem,
        queryLabel: "Telegram trigger / full",
      };
      upsertXPipelineRealtimeUpdate({
        eventType: "TG_HYBRID",
        account: feedItem.username,
        displayName: feedItem.displayName,
        createdAt: feedItem.createdAt,
        profileUrl: feedItem.profileUrl,
        remark: candidate.messageUrl,
        feedItem,
      });
      markXHybridSource({
        sourceId: ready.item.sourceId,
        status: "enriched",
        detail: `tweet-id ${tweetId}`,
        tweetId,
      });
      stats.enriched += 1;
      stats.samples.push({
        username: feedItem.username,
        tweetId: feedItem.id,
        status: "enriched",
        detail:
          quotedResult.status === "fetched"
            ? `${feedItem.text.slice(0, 80)} / quoted fetched ${quotedResult.quotedTweetId}`
            : feedItem.text.slice(0, 80),
      });
    } catch (error) {
      stats.failed += 1;
      markXHybridSource({
        sourceId: ready.item.sourceId,
        status: "error",
        detail: `tweet-id fetch failed for ${tweetId}: ${String(error)}`,
        tweetId,
      });
      stats.samples.push({
        username: candidate.username,
        tweetId,
        status: "error",
        detail: String(error),
      });
    }
  }

  setXPipelineHealth({
    scope: "hybrid",
    status: stats.failed > 0 && stats.enriched === 0 ? "error" : "live",
    detail: `hybrid backfill enriched ${stats.enriched}/${stats.selected}, reserved ${stats.pointsReserved} points`,
  });

  return NextResponse.json({
    success: true,
    ...stats,
    usage: getXApiUsageSnapshot(),
  });
}
