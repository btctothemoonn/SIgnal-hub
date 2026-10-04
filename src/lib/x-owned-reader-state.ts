import type { DatabaseSync } from "node:sqlite";
import { getXPipelineDb } from "./x-pipeline-store.ts";
import { getXOwnedReaderConfig, normalizeXOwnedUsername, selectXOwnedReaderAccounts, type XOwnedReaderConfig, type XOwnedReaderEnv } from "./x-owned-reader-config.ts";

type Row = Record<string, unknown>;
export type XOwnedReaderAccountState = {
  username: string;
  bootstrapFromAt: string | null;
  pendingThroughAt: string | null;
  coveredThroughAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastIngestedAt: string | null;
  userId: string | null;
  status: string;
  reason: string | null;
  nextRetryAt: string | null;
  incompleteCount: number;
  lastIncompleteReason: string | null;
  coverageKind: string | null;
  replyCoverageComplete: boolean | null;
  replyReason: string | null;
  subscriberContentExcluded: number;
  subscriberExcludedTweetIds: string[];
};

export const X_OWNED_SAFE_REASONS = new Set([
  "timeline_structure_unrecognized", "unknown_conversation_module", "unparsed_entry", "cursor_stalled", "page_limit_reached", "request_budget_reached", "cycle_deadline_reached", "rate_limited", "login_or_access_challenge", "unexpected_api_response", "network_error_paused", "unexpected_redirect", "unexpected_cross_origin_redirect", "unexpected_request_destination", "redirect_limit_reached", "session_unavailable", "session_cooldown", "sdk_unavailable", "protocol_invalid", "bridge_timeout", "bridge_failed", "bridge_output_limit", "bridge_line_limit", "bridge_missing_completion", "account_missing_completion", "feed_write_failed", "disabled", "never_checked", "invalid_check_timestamp", "backlog_limit_repeated", "in_progress", "configuration_missing", "network_error", "entry_quarantined", "reply_focal_unverified", "reply_page_budget_unavailable",
  "protected_account", "author_mismatch", "invalid_cooldown", "library_or_network_error",
]);
export function safeXOwnedReason(value: unknown, fallback = "protocol_invalid"): string {
  return typeof value === "string" && X_OWNED_SAFE_REASONS.has(value) ? value : fallback;
}
function text(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function excludedTweetIds(value:unknown):string[] {
  if(typeof value!=="string" || value.length>24000)return [];
  try {
    const ids:unknown=JSON.parse(value);
    return Array.isArray(ids) && ids.length<=1000 && ids.every(id=>typeof id==="string" && /^[1-9]\d{0,19}$/.test(id) && BigInt(id)<=BigInt("18446744073709551615")) && new Set(ids).size===ids.length ? ids : [];
  } catch {return [];}
}
function tableExists(db: DatabaseSync, name: string) {
  return Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name));
}

export function initXOwnedReaderStateDb(db: DatabaseSync = getXPipelineDb()) {
  db.exec(`
    create table if not exists x_owned_reader_state (
      username_key text primary key, username text not null, user_id text,
      bootstrap_from_at text, pending_through_at text, covered_through_at text,
      last_attempt_at text, last_successful_check_at text, last_ingested_at text,
      status text not null default 'starting', reason text, next_retry_at text,
      incomplete_count integer not null default 0, last_incomplete_reason text, coverage_kind text, reply_coverage_complete integer,
      reply_reason text, subscriber_content_excluded integer not null default 0,
      subscriber_excluded_tweet_ids_json text not null default '[]', updated_at text not null
    );
    create table if not exists x_owned_reader_control (
      id integer primary key check(id=1), paused integer not null default 0,
      reason text, next_retry_at text, updated_at text not null
    );
    create table if not exists x_owned_reader_routes (
      username_key text primary key, username text not null, route text not null,
      reason text not null, evidence text not null, evidence_at text, updated_at text not null
    );
  `);
  const columns = new Set(db.prepare("pragma table_info(x_owned_reader_state)").all().map(row => String(row.name)));
  for (const [name, type] of [["coverage_kind","text"],["reply_coverage_complete","integer"],["reply_reason","text"],["last_incomplete_reason","text"],["subscriber_content_excluded","integer not null default 0"],["subscriber_excluded_tweet_ids_json","text not null default '[]'"]]) {
    if (!columns.has(name)) db.exec(`alter table x_owned_reader_state add column ${name} ${type}`);
  }
}

export function getXOwnedReaderAccountState(username: string, db: DatabaseSync = getXPipelineDb()): XOwnedReaderAccountState | null {
  if (!tableExists(db, "x_owned_reader_state")) return null;
  const row = db.prepare("select * from x_owned_reader_state where username_key=?").get(normalizeXOwnedUsername(username)) as Row | undefined;
  if (!row) return null;
  const subscriberExcludedTweetIds=excludedTweetIds(row.subscriber_excluded_tweet_ids_json);
  const subscriberContentExcluded=Number(row.subscriber_content_excluded || 0);
  const validExclusions=Number.isSafeInteger(subscriberContentExcluded) && subscriberContentExcluded===subscriberExcludedTweetIds.length;
  return { username: String(row.username), userId: text(row.user_id), bootstrapFromAt: text(row.bootstrap_from_at), pendingThroughAt: text(row.pending_through_at), coveredThroughAt: text(row.covered_through_at), lastAttemptAt: text(row.last_attempt_at), lastSuccessfulCheckAt: text(row.last_successful_check_at), lastIngestedAt: text(row.last_ingested_at), status: String(row.status), reason: row.reason ? safeXOwnedReason(row.reason) : null, nextRetryAt: text(row.next_retry_at), incompleteCount: Number(row.incomplete_count || 0), lastIncompleteReason: row.last_incomplete_reason ? safeXOwnedReason(row.last_incomplete_reason) : null, coverageKind: row.coverage_kind === "posts-and-quotes" ? "posts-and-quotes" : null, replyCoverageComplete: row.reply_coverage_complete === 1 ? true : row.reply_coverage_complete === 0 ? false : null, replyReason: row.reply_reason ? safeXOwnedReason(row.reply_reason) : null,subscriberContentExcluded:validExclusions ? subscriberContentExcluded : 0,subscriberExcludedTweetIds:validExclusions ? subscriberExcludedTweetIds : [] };
}

export function getXOwnedReaderPause(db: DatabaseSync = getXPipelineDb()) {
  if (!tableExists(db, "x_owned_reader_control")) return null;
  const row = db.prepare("select * from x_owned_reader_control where id=1 and paused=1").get() as Row | undefined;
  if (!row) return null;
  const nextRetryAt=text(row.next_retry_at);
  return {reason:safeXOwnedReason(row.reason),nextRetryAt:nextRetryAt && Number.isFinite(Date.parse(nextRetryAt)) ? nextRetryAt : null};
}

export function pauseXOwnedReader(reason: string, nextRetryAt: string | null, db: DatabaseSync, nowMs: number) {
  db.prepare(`insert into x_owned_reader_control(id,paused,reason,next_retry_at,updated_at) values(1,1,?,?,?) on conflict(id) do update set paused=1,reason=excluded.reason,next_retry_at=excluded.next_retry_at,updated_at=excluded.updated_at`).run(safeXOwnedReason(reason), nextRetryAt, new Date(nowMs).toISOString());
}

export function prepareXOwnedReaderAccounts(usernames: readonly string[], config: XOwnedReaderConfig, db: DatabaseSync, nowMs: number) {
  initXOwnedReaderStateDb(db);
  const nowAt = new Date(nowMs).toISOString();
  return selectXOwnedReaderAccounts(usernames, config).map((username) => {
    const key = normalizeXOwnedUsername(username);
    db.prepare(`insert into x_owned_reader_state(username_key,username,bootstrap_from_at,pending_through_at,last_attempt_at,status,reason,updated_at) values(?,?,?,?,?,'connecting','in_progress',?) on conflict(username_key) do update set last_attempt_at=excluded.last_attempt_at, status='connecting',reason='in_progress',updated_at=excluded.updated_at`).run(key,key,new Date(nowMs - 48 * 60 * 60_000).toISOString(),nowAt,nowAt,nowAt);
    const state = getXOwnedReaderAccountState(key,db)!;
    const throughAt = state.pendingThroughAt || nowAt;
    db.prepare("update x_owned_reader_state set pending_through_at=? where username_key=?").run(throughAt,key);
    const fromAt = state.coveredThroughAt ? new Date(Date.parse(state.coveredThroughAt) - 15 * 60_000).toISOString() : state.bootstrapFromAt!;
    return { username:key, ...(state.userId ? {userId:state.userId} : {}), fromAt, throughAt };
  });
}

function monitorEvidence(username: string, db: DatabaseSync) {
  let evidenceAt: string | null = null;
  if (tableExists(db,"x_feed_observations")) {
    const row = db.prepare("select max(last_seen_at) as seen_at from x_feed_observations where lower(author_username)=? and source='monitor985'").get(username) as Row | undefined;
    evidenceAt = text(row?.seen_at);
  }
  if (!evidenceAt && tableExists(db,"x_feed")) {
    const row = db.prepare("select max(updated_at) as seen_at from x_feed where account_username_key=? and (lower(query_label) like '%985%' or lower(event_type) like '%985%')").get(username) as Row | undefined;
    evidenceAt = text(row?.seen_at);
  }
  return { evidence: evidenceAt ? "covered" : username === "fffffiyes_yu" ? "unmonitored" : "unverified", evidenceAt: evidenceAt || (username === "fffffiyes_yu" ? "2026-10-04T01:38:00.000Z" : null) };
}

export function recordXOwnedReaderRoutes(usernames: readonly string[], config: XOwnedReaderConfig, db: DatabaseSync, nowMs: number) {
  const owned = new Set(selectXOwnedReaderAccounts(usernames,config).map(normalizeXOwnedUsername));
  for (const username of usernames) {
    const key=normalizeXOwnedUsername(username); if (!key) continue;
    const route=owned.has(key) ? "owned-reader" : "monitor985";
    const evidence=monitorEvidence(key,db);
    db.prepare(`insert into x_owned_reader_routes(username_key,username,route,reason,evidence,evidence_at,updated_at) values(?,?,?,?,?,?,?) on conflict(username_key) do update set username=excluded.username,route=excluded.route,reason=excluded.reason,evidence=excluded.evidence,evidence_at=excluded.evidence_at,updated_at=excluded.updated_at`).run(key,username,route,route === "owned-reader" ? key === "fffffiyes_yu" ? "approved_trial_985_unmonitored" : "approved_trial_985_unverified" : "primary_985",evidence.evidence,evidence.evidenceAt,new Date(nowMs).toISOString());
  }
}

export function getXAccountCoverageSnapshot(usernames: readonly string[], db: DatabaseSync = getXPipelineDb(), env: XOwnedReaderEnv = process.env, nowMs = Date.now()) {
  const config=getXOwnedReaderConfig(env);
  const owned=new Set(selectXOwnedReaderAccounts(usernames,config).map(normalizeXOwnedUsername));
  const seen=new Set<string>();
  const pause=getXOwnedReaderPause(db);
  const pauseActive=Boolean(pause && (!pause.nextRetryAt || Date.parse(pause.nextRetryAt)>nowMs));
  const accounts=usernames.flatMap((username) => {
    const key=normalizeXOwnedUsername(username); if (!key || seen.has(key)) return []; seen.add(key);
    const route=owned.has(key) ? "owned-reader" : "monitor985";
    const evidence=monitorEvidence(key,db);
    const state=getXOwnedReaderAccountState(key,db);
    const checkedMs=state?.lastSuccessfulCheckAt ? Date.parse(state.lastSuccessfulCheckAt) : NaN;
    const invalidTimestamp=Boolean(state?.lastSuccessfulCheckAt && (!Number.isFinite(checkedMs) || checkedMs>nowMs+60_000));
    const checkAgeMs=Number.isFinite(checkedMs) && !invalidTimestamp ? Math.max(0,nowMs-checkedMs) : null;
    const stale=route === "owned-reader" && (invalidTimestamp || checkAgeMs === null || checkAgeMs>config.staleAfterMs);
    const paused=route === "owned-reader" && (!config.enabled || pauseActive);
    let lastIngestedAt=state?.lastIngestedAt || null;
    if (!lastIngestedAt && tableExists(db,"x_feed")) lastIngestedAt=text((db.prepare("select max(inserted_at) as inserted_at from x_feed where account_username_key=?").get(key) as Row)?.inserted_at);
    return [{username,route,routeReason:route === "owned-reader" ? key === "fffffiyes_yu" ? "approved_trial_985_unmonitored" : "approved_trial_985_unverified" : "primary_985",...evidence,bootstrapFromAt:state?.bootstrapFromAt || null,pendingThroughAt:state?.pendingThroughAt || null,coveredThroughAt:state?.coveredThroughAt || null,lastAttemptAt:state?.lastAttemptAt || null,lastSuccessfulCheckAt:state?.lastSuccessfulCheckAt || null,lastIngestedAt,checkAgeMs,stale,status:paused ? "paused" : invalidTimestamp ? "error" : state?.status || (route === "owned-reader" ? "starting" : "primary"),reason:paused ? config.enabled ? pause?.reason || "session_cooldown" : "disabled" : invalidTimestamp ? "invalid_check_timestamp" : state?.reason || (route === "owned-reader" ? "never_checked" : null),nextRetryAt:pauseActive ? pause?.nextRetryAt || null : state?.nextRetryAt || null,incompleteCount:state?.incompleteCount || 0,coverageKind:state?.coverageKind || null,replyCoverageComplete:state?.replyCoverageComplete ?? null,replyReason:state?.replyReason || null,subscriberContentExcluded:state?.subscriberContentExcluded || 0,subscriberExcludedTweetIds:state?.subscriberExcludedTweetIds || []}];
  });
  return {generatedAt:new Date(nowMs).toISOString(),enabled:config.enabled,trial:true,counts:{total:accounts.length,monitor985:accounts.filter(a=>a.route === "monitor985").length,ownedReader:accounts.filter(a=>a.route === "owned-reader").length,covered:accounts.filter(a=>a.evidence === "covered").length,unmonitored:accounts.filter(a=>a.evidence === "unmonitored").length,unverified:accounts.filter(a=>a.evidence === "unverified").length,stale:accounts.filter(a=>a.stale).length,incomplete:accounts.filter(a=>a.route === "owned-reader" && a.status === "incomplete").length,paused:accounts.filter(a=>a.route === "owned-reader" && a.status === "paused").length,replyIncomplete:accounts.filter(a=>a.route === "owned-reader" && a.replyCoverageComplete===false).length},accounts};
}
