import { X_OWNED_READER_DEFAULT_USERNAMES } from "../src/lib/x-owned-reader-config.ts";

// Known structural timeline failures. Isolated authors are skipped for hours and
// never receive a post-activation success, so they must not block a release.
const STRUCTURAL_REASONS = new Set([
  "structural_isolated",
  "unknown_conversation_module",
  "timeline_structure_unrecognized",
]);
const SESSION_REASONS = new Set([
  "session_unavailable",
  "login_or_access_challenge",
  "authentication_required",
]);
const CONFIG_REASONS = new Set(["configuration_missing"]);
const PROCESS_REASONS = new Set([
  "bridge_failed",
  "bridge_timeout",
  "bridge_missing_completion",
  "bridge_output_limit",
  "bridge_line_limit",
  "sdk_unavailable",
  "protocol_invalid",
]);
const SEED_USERNAMES = new Set(X_OWNED_READER_DEFAULT_USERNAMES);

function outcome(ready, fatal, reason, warnings = []) {
  return { ready, fatal, reason, warnings };
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function isStructural(account) {
  return account?.structuralIsolated === true
    || account?.structuralIncomplete === true
    || STRUCTURAL_REASONS.has(account?.reason)
    || STRUCTURAL_REASONS.has(account?.lastIncompleteReason);
}

function blocking(account) {
  return ["paused", "error", "failed"].includes(account?.status);
}

function checkedAfterActivation(account, activatedAt) {
  if (!Number.isFinite(activatedAt)) return false;
  if (["incomplete", "paused", "error", "failed", "starting", "connecting", "reading"].includes(account.status)) return false;
  const checkedAt = Date.parse(account.lastSuccessfulCheckAt || "");
  const attemptedAt = Date.parse(account.lastAttemptAt || "");
  return Number.isFinite(checkedAt) && Number.isFinite(attemptedAt) && checkedAt >= activatedAt && attemptedAt >= activatedAt;
}

function structuralWarnings(accounts) {
  return accounts
    .filter(isStructural)
    .map(account => `structural:${normalizeUsername(account.username)}:${account.reason || "structural_isolated"}`);
}

function fatalReason(assigned) {
  for (const account of assigned) {
    if (!blocking(account)) continue;
    if (CONFIG_REASONS.has(account.reason)) return "configuration_missing";
    if (SESSION_REASONS.has(account.reason)) return "session_unavailable";
  }
  const live = assigned.filter(account => !isStructural(account));
  const pool = live.length ? live : assigned;
  const processDown = pool.every(account => blocking(account) && (PROCESS_REASONS.has(account.reason) || (["error", "failed"].includes(account.status) && !account.reason)));
  return processDown ? "process_down" : null;
}

function globalCooldown(assigned) {
  const live = assigned.filter(account => !isStructural(account));
  if (!live.length) return false;
  return live.every(account => account.status === "paused"
    && !CONFIG_REASONS.has(account.reason)
    && !SESSION_REASONS.has(account.reason)
    && !PROCESS_REASONS.has(account.reason));
}

function samplePassed(eligible, activatedAt) {
  const passed = eligible.filter(account => checkedAfterActivation(account, activatedAt));
  const ratioMet = passed.length * 5 >= eligible.length * 4;
  const seeds = eligible.filter(account => SEED_USERNAMES.has(normalizeUsername(account.username)));
  const seedMet = seeds.length > 0 && seeds.every(account => checkedAfterActivation(account, activatedAt));
  return { passed: passed.length, eligible: eligible.length, ratioMet, seedMet, met: ratioMet || seedMet };
}

export function evaluateOwnedReaderReadiness(snapshot, startedAt) {
  if (snapshot?.enabled === false) return outcome(true, false, "disabled");
  if (snapshot?.enabled !== true || !Array.isArray(snapshot.accounts)) return outcome(false, true, "invalid_coverage");
  const assigned = snapshot.accounts.filter(account => account?.route === "owned-reader");
  if (!assigned.length) return outcome(false, true, "no_assigned_authors");

  const fatal = fatalReason(assigned);
  if (fatal) return outcome(false, true, fatal, structuralWarnings(assigned));

  const structural = structuralWarnings(assigned);
  if (globalCooldown(assigned)) {
    const reason = assigned.find(account => !isStructural(account))?.reason || "rate_limited";
    return outcome(true, false, "rate_limited_cooldown", [...structural, `cooldown:${reason}`]);
  }

  const eligible = assigned.filter(account => !isStructural(account));
  if (!eligible.length) {
    const paused = assigned.find(account => account.status === "paused");
    const warnings = paused ? [...structural, `cooldown:${paused.reason || "paused"}`] : structural;
    return outcome(true, false, "structural_isolated", warnings);
  }

  const sample = samplePassed(eligible, Date.parse(startedAt));
  if (sample.met) return outcome(true, false, "authors_checked", structural);
  return outcome(false, false, "waiting_for_first_checks", [...structural, `sample:${sample.passed}/${sample.eligible}`]);
}
