import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAiProviderAttempt, readAiUsageSummary } from "./ai-usage.ts";
import { runWithAiProviderFallback } from "./ai-provider-fallback.ts";

const dir = mkdtempSync(join(tmpdir(), "ai-usage-"));
const env = { SIGNAL_HUB_RUNTIME_DIR: dir };
const nowMs = Date.parse("2026-10-30T02:00:00.000Z");
try {
  recordAiProviderAttempt({ providerId: "minimax", model: "MiniMax-M3", ok: true, atMs: nowMs, env });
  recordAiProviderAttempt({ providerId: "minimax", model: "MiniMax-M3", ok: false, atMs: nowMs, env });
  recordAiProviderAttempt({ providerId: "minimax", model: "MiniMax-M3", ok: true, atMs: nowMs - 10 * 24 * 60 * 60 * 1000, env });
  const summary = readAiUsageSummary(env, nowMs);
  assert.equal(summary.windowDays, 7);
  assert.equal(summary.totals.calls, 1);
  assert.equal(summary.totals.errors, 1);
  assert.equal(summary.byProvider[0].providerId, "minimax");
  assert.equal(summary.byProvider[0].model, "MiniMax-M3");
  assert.equal(JSON.stringify(summary).includes("sk-"), false);

  const isolated = { SIGNAL_HUB_RUNTIME_DIR: join(dir, "fallback") };
  process.env.SIGNAL_HUB_RUNTIME_DIR = isolated.SIGNAL_HUB_RUNTIME_DIR;
  await runWithAiProviderFallback({
    providers: [{ id: "minimax", baseUrl: "https://api.minimaxi.com/v1", apiKey: "secret-key", model: "MiniMax-M3" }],
    now: nowMs,
    request: async () => "ok",
  });
  const after = readAiUsageSummary(isolated, nowMs);
  assert.equal(after.totals.calls, 1);
  assert.equal(JSON.stringify(after).includes("secret-key"), false);
} finally {
  delete process.env.SIGNAL_HUB_RUNTIME_DIR;
  rmSync(dir, { recursive: true, force: true });
}

console.log("ok - ai usage summary");
