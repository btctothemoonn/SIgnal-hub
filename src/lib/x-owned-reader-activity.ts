import type { DatabaseSync } from "node:sqlite";
import type { XOwnedReaderAccountState } from "./x-owned-reader-state.ts";

// Quiet authors are checked every few rounds so the 80-request round budget
// covers more authors without raising frequency or adding accounts.
export const X_OWNED_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const X_OWNED_ACTIVITY_RECENT_POST_MS = 6 * 60 * 60_000;
export const X_OWNED_ACTIVITY_QUIET_BELOW = 7;
export const X_OWNED_ACTIVITY_MODERATE_BELOW = 21;

export function xOwnedReaderCheckRounds(usernameKey: string, db: DatabaseSync, nowMs: number): 1 | 2 | 3 {
  const table = db.prepare("select 1 from sqlite_master where type='table' and name='x_feed'").get();
  if (!table) return 1;
  const row = db.prepare("select count(*) as posts, max(created_at) as latest from x_feed where account_username_key=? and created_at>=?")
    .get(usernameKey, new Date(nowMs - X_OWNED_ACTIVITY_WINDOW_MS).toISOString()) as { posts: number; latest: string | null } | undefined;
  const posts = Number(row?.posts || 0);
  const latestMs = Date.parse(row?.latest || "");
  if (Number.isFinite(latestMs) && nowMs - latestMs < X_OWNED_ACTIVITY_RECENT_POST_MS) return 1;
  if (posts < X_OWNED_ACTIVITY_QUIET_BELOW) return 3;
  if (posts < X_OWNED_ACTIVITY_MODERATE_BELOW) return 2;
  return 1;
}

export function isXOwnedReaderCheckDue(state: XOwnedReaderAccountState | null, rounds: number, intervalMs: number, nowMs: number) {
  if (rounds <= 1 || !state || state.status !== "complete" || state.pendingThroughAt || state.nextRetryAt) return true;
  const checkedMs = Date.parse(state.lastSuccessfulCheckAt || "");
  if (!Number.isFinite(checkedMs) || checkedMs > nowMs) return true;
  // Half an interval of slack absorbs scheduler jitter between round starts.
  return nowMs - checkedMs >= rounds * intervalMs - intervalMs / 2;
}

export function xOwnedReaderStaleAfterForRounds(staleAfterMs: number, intervalMs: number, rounds: number) {
  return staleAfterMs + Math.max(0, rounds - 1) * intervalMs;
}
