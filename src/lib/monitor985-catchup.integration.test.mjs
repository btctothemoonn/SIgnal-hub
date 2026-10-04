import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Existing route utility uses bundler-style extensionless imports. Resolve them
// in the test module without changing the production behavior being exercised.
const sourceUrl = new URL("./monitor985-catchup.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8").replace(
  /from "\.\/([^".]+)"/g,
  (_, name) => `from ${JSON.stringify(new URL(`./${name}.ts`, sourceUrl).href)}`,
);
const executable = stripTypeScriptTypes(source, { mode: "transform" });
const { getXPipelineDb, upsertXPipelineAccount, closeXPipelineDb } = await import("./x-pipeline-store.ts");
const directory = mkdtempSync(join(tmpdir(), "owned-catchup-union-"));
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const originalDb = process.env.X_PIPELINE_DB;
process.env.X_PIPELINE_DB = join(directory, "feed.sqlite");
process.chdir(directory);
mkdirSync(join(directory, ".signal-hub"));
writeFileSync(join(directory, ".signal-hub", "runtime-config.json"), JSON.stringify({ twitterAccounts: [{ ref: "legacy985", tags: [] }, { ref: "readeronly", tags: [] }] }));
const event = username => ({ eventType: "NEW_TWEET", twAccount: username, createdAt: "2026-10-04T01:00:00Z", content: { id: username === "readeronly" ? "2106520000000000001" : "2106520000000000002", userScreenName: username, text: "公开推文内容", createdAt: "2026-10-04T01:00:00Z" } });
globalThis.fetch = async url => {
  const path = new URL(url).pathname;
  return Response.json(path === "/api/watch-config"
    ? { config: { twitter: ["legacy985", "foreign985"] }, overlay: { twitter: { extraFollows: [], unfollowed: [] } } }
    : path === "/api/twitter-live-events" ? { events: [event("readeronly"), event("foreign985")] } : { events: [] });
};
try {
  const { runMonitor985ManualCatchup } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  upsertXPipelineAccount({ username: "readeronly", name: "readeronly", tags: [] });
  const result = await runMonitor985ManualCatchup({ env: { TWITTER_TRANSLATE_ENABLED: "false", MONITOR985_TRUTH_ACCOUNTS: "realDonaldTrump" } });
  const db = getXPipelineDb();
  assert.equal(db.prepare("select enabled from x_accounts where username_key = 'readeronly'").get()?.enabled, 1, "985 refresh must preserve local reader-only account");
  assert.equal(db.prepare("select count(*) as count from x_accounts where username_key = 'foreign985'").get().count, 0, "remote-only author must not become a local watched account");
  assert.equal(result.accepted, 1, "late985event for a locally watched reader account remains acceptable");
  assert.equal(result.ignored, 1);
  assert.equal(db.prepare("select username from x_feed").get().username, "readeronly");
} finally {
  closeXPipelineDb();
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  if (originalDb === undefined) delete process.env.X_PIPELINE_DB;
  else process.env.X_PIPELINE_DB = originalDb;
  rmSync(directory, { recursive: true, force: true });
}
console.log("ok -985manual catchup preserves the complete local watched-account union");
