import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  fetchBinanceHynixPremiumQuote,
  type BinanceHynixPremiumQuote,
} from "./binance-hynix-premium.ts";
import { createImportantPushOutbox } from "./important-push-outbox.ts";
import { isFreshPushTime } from "./important-push-policy.ts";
import type { EnvLike, PushEvent } from "./important-push-types.ts";
import {
  HYNIX_PREMIUM_ALERT_THRESHOLD_PCT,
  type HynixPremiumAlertSettings,
} from "./hynix-premium-alert.ts";
import { persistLegacyHynixPremiumAlertUpgrade, loadRuntimeConfig } from "./runtime-config.ts";
import { getRuntimeDataPath } from "./runtime-storage.ts";

export const HYNIX_PREMIUM_PUSH_FRESH_MS = 3 * 60 * 1000;
export const HYNIX_PREMIUM_PUSH_TTL_MS = 15 * 60 * 1000;
export const HYNIX_PREMIUM_PUSH_RULE_VERSION = "hynix-premium-v1";

export type HynixPremiumPushState = {
  latched: boolean;
  lastEventId: string | null;
  lastObservedAt: string | null;
  lastPremiumPct: number | null;
};

export const EMPTY_HYNIX_PREMIUM_PUSH_STATE: HynixPremiumPushState = {
  latched: false,
  lastEventId: null,
  lastObservedAt: null,
  lastPremiumPct: null,
};

export type HynixPremiumPushDecision = {
  state: HynixPremiumPushState;
  event: PushEvent | null;
  reason: string;
};

function roundPct(value: number) {
  return Math.round(value * 10) / 10;
}

function evidenceNumber(event: PushEvent, key: string) {
  const prefix = `${key}=`;
  const raw = event.evidence.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function decideHynixPremiumPush(input: {
  state?: HynixPremiumPushState | null;
  enabled: boolean;
  thresholdPct: number;
  premiumPct: number | null;
  observedAt: string | null;
  nowMs: number;
  freshMs?: number;
}): HynixPremiumPushDecision {
  const state = input.state ?? EMPTY_HYNIX_PREMIUM_PUSH_STATE;
  const freshMs = input.freshMs ?? HYNIX_PREMIUM_PUSH_FRESH_MS;
  const thresholdPct = roundPct(input.thresholdPct);
  if (!input.enabled) {
    return { state, event: null, reason: "disabled" };
  }
  if (
    input.premiumPct === null ||
    !Number.isFinite(input.premiumPct) ||
    !input.observedAt
  ) {
    return { state, event: null, reason: "missing_quote" };
  }
  const observedMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedMs) || observedMs > input.nowMs + 60_000) {
    return { state, event: null, reason: "invalid_quote_time" };
  }
  if (!isFreshPushTime(input.observedAt, input.nowMs, freshMs)) {
    return { state, event: null, reason: "stale_quote" };
  }
  const premiumPct = roundPct(input.premiumPct);
  if (premiumPct < thresholdPct) {
    return {
      state: {
        latched: false,
        lastEventId: null,
        lastObservedAt: input.observedAt,
        lastPremiumPct: premiumPct,
      },
      event: null,
      reason: "below",
    };
  }
  const nextState: HynixPremiumPushState = {
    latched: true,
    lastEventId: state.lastEventId,
    lastObservedAt: input.observedAt,
    lastPremiumPct: premiumPct,
  };
  if (state.latched) {
    return { state: nextState, event: null, reason: "already_latched" };
  }
  const id = `hynix:${thresholdPct}:${input.observedAt}`;
  const event: PushEvent = {
    id,
    source: "hynix",
    episodeId: id,
    stage: "hynix_premium",
    priority: 0,
    title: `海力士溢价 ${premiumPct.toFixed(1)}%`,
    body: `已达到 ${thresholdPct}% 提醒线。数据时间 ${input.observedAt}。`,
    target: "/stocks",
    occurredAt: input.observedAt,
    expiresAt: new Date(input.nowMs + HYNIX_PREMIUM_PUSH_TTL_MS).toISOString(),
    sourcePublishedAt: input.observedAt,
    ruleVersion: HYNIX_PREMIUM_PUSH_RULE_VERSION,
    evidence: [
      `premiumPct=${premiumPct}`,
      `thresholdPct=${thresholdPct}`,
      `observedAt=${input.observedAt}`,
    ],
  };
  return {
    state: { ...nextState, lastEventId: id },
    event,
    reason: "crossed",
  };
}

export function hynixPremiumPushStillQualified(
  event: PushEvent,
  state: HynixPremiumPushState,
  nowMs: number,
  freshMs = HYNIX_PREMIUM_PUSH_FRESH_MS,
) {
  if (event.source !== "hynix" || event.stage !== "hynix_premium") return false;
  if (Date.parse(event.expiresAt) <= nowMs) return false;
  if (!event.sourcePublishedAt || !isFreshPushTime(event.sourcePublishedAt, nowMs, freshMs)) return false;
  const thresholdPct = evidenceNumber(event, "thresholdPct") ?? HYNIX_PREMIUM_ALERT_THRESHOLD_PCT;
  const eventObservedMs = Date.parse(event.sourcePublishedAt);
  const stateObservedMs = state.lastObservedAt ? Date.parse(state.lastObservedAt) : Number.NaN;
  if (
    Number.isFinite(stateObservedMs) &&
    stateObservedMs >= eventObservedMs &&
    state.lastPremiumPct !== null &&
    state.lastPremiumPct < thresholdPct
  ) {
    return false;
  }
  return true;
}

export function openHynixPremiumPushStore(path = getRuntimeDataPath(process.env, "hynix-premium-push.sqlite")) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;");
  const outbox = createImportantPushOutbox(db);
  db.exec(`CREATE TABLE IF NOT EXISTS hynix_premium_push_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL
  );`);
  function readState(): HynixPremiumPushState {
    const row = db.prepare("SELECT state_json FROM hynix_premium_push_state WHERE id=1").get() as { state_json: string } | undefined;
    if (!row) return { ...EMPTY_HYNIX_PREMIUM_PUSH_STATE };
    try {
      const parsed = JSON.parse(row.state_json) as Partial<HynixPremiumPushState>;
      return {
        latched: parsed.latched === true,
        lastEventId: typeof parsed.lastEventId === "string" ? parsed.lastEventId : null,
        lastObservedAt: typeof parsed.lastObservedAt === "string" ? parsed.lastObservedAt : null,
        lastPremiumPct: typeof parsed.lastPremiumPct === "number" && Number.isFinite(parsed.lastPremiumPct) ? parsed.lastPremiumPct : null,
      };
    } catch {
      return { ...EMPTY_HYNIX_PREMIUM_PUSH_STATE };
    }
  }
  function writeState(state: HynixPremiumPushState) {
    db.prepare(`INSERT INTO hynix_premium_push_state(id, state_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json`).run(JSON.stringify(state));
  }
  return {
    readState,
    readAfter: outbox.readAfter,
    getBaseline: () => ({ lastSequence: outbox.getBaseline().lastSequence }),
    observe(input: {
      enabled: boolean;
      thresholdPct: number;
      premiumPct: number | null;
      observedAt: string | null;
      nowMs: number;
    }) {
      db.exec("BEGIN IMMEDIATE;");
      try {
        const decision = decideHynixPremiumPush({ ...input, state: readState() });
        writeState(decision.state);
        if (decision.event) outbox.appendEvent(decision.event);
        db.exec("COMMIT;");
        return decision;
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    },
    revalidate(event: PushEvent, nowMs: number) {
      return hynixPremiumPushStillQualified(event, readState(), nowMs);
    },
    close() { db.close(); },
  };
}

export type HynixPremiumPushStore = ReturnType<typeof openHynixPremiumPushStore>;

export async function runHynixPremiumPushCycle(input: {
  env?: EnvLike;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  store?: HynixPremiumPushStore;
  settings?: HynixPremiumAlertSettings;
  quote?: BinanceHynixPremiumQuote | null;
} = {}) {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const ownsStore = !input.store;
  const store = input.store ?? openHynixPremiumPushStore(getRuntimeDataPath(env, "hynix-premium-push.sqlite"));
  try {
    if (!input.settings) await persistLegacyHynixPremiumAlertUpgrade();
    const settings = input.settings ?? (await loadRuntimeConfig()).hynixPremiumAlert;
    let quote = input.quote ?? null;
    let fetchError: string | null = null;
    if (settings.enabled && input.quote === undefined) {
      try {
        quote = await fetchBinanceHynixPremiumQuote({ fetchImpl: input.fetchImpl, env });
      } catch (error) {
        fetchError = error instanceof Error ? error.message : String(error);
        quote = null;
      }
    }
    const decision = store.observe({
      enabled: settings.enabled,
      thresholdPct: settings.thresholdPct,
      premiumPct: quote?.premiumPct ?? null,
      observedAt: quote?.observedAt ?? null,
      nowMs,
    });
    return {
      reason: decision.reason,
      eventId: decision.event?.id ?? null,
      fetchError,
      enabled: settings.enabled,
      thresholdPct: settings.thresholdPct,
      premiumPct: quote?.premiumPct ?? null,
      observedAt: quote?.observedAt ?? null,
    };
  } finally {
    if (ownsStore) store.close();
  }
}
