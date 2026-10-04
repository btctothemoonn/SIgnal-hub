export function evaluateOwnedReaderReadiness(snapshot, startedAt) {
  if (snapshot?.enabled === false) return { ready: true, fatal: false, reason: "disabled" };
  if (snapshot?.enabled !== true || !Array.isArray(snapshot.accounts)) return { ready: false, fatal: true, reason: "invalid_coverage" };
  const assigned = snapshot.accounts.filter(account => account.route === "owned-reader");
  if (!assigned.length) return { ready: false, fatal: true, reason: "no_assigned_authors" };
  const paused = assigned.some(account => ["paused", "error", "failed"].includes(account.status));
  if (paused) return { ready: false, fatal: true, reason: "reader_paused_or_failed" };
  const activatedAt = Date.parse(startedAt);
  const ready = Number.isFinite(activatedAt) && assigned.every(account => {
    const checkedAt = Date.parse(account.lastSuccessfulCheckAt || "");
    const attemptedAt = Date.parse(account.lastAttemptAt || "");
    return account.status !== "incomplete" && Number.isFinite(checkedAt) && Number.isFinite(attemptedAt) && checkedAt >= activatedAt && attemptedAt >= activatedAt;
  });
  return { ready, fatal: false, reason: ready ? "authors_checked" : "waiting_for_first_checks" };
}
