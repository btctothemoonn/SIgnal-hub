
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const cwd = mkdtempSync(join(tmpdir(), "x-6551-worker-"));
const dbPath = join(cwd, "test.sqlite");
const token = "test-only-token";
const id = "2123456789012345678";
const worker = fileURLToPath(new URL("./x-pipeline-worker.mjs", import.meta.url));
const preload = join(cwd, "socket.mjs");
const fixture = ({ id, token }) => {
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => realSetInterval(fn, ms === 20_000 ? 20 : ms);

  class FixtureSocket extends EventTarget {
    static OPEN = 1;
    static CLOSING = 2;
    static connections = 0;
    readyState = FixtureSocket.OPEN;
    pings = 0;

    constructor(url) {
      super();
      assert.equal(url.searchParams.get("token"), token);
      this.number = ++FixtureSocket.connections;
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }

    message(payload) {
      this.dispatchEvent(new MessageEvent("message", { data: payload }));
    }

    send(message) {
      if (message === "ping") {
        this.pings++;
        this.message("pong");
        return;
      }
      assert.deepEqual(JSON.parse(message), { jsonrpc: "2.0", id: 1, method: "twitter.subscribe" });
      this.message(JSON.stringify({ id: 1, result: { success: true } }));
      for (const [tweetId, account] of [[id, "Alice"], ["2123456789012345679", "Untracked"]]) {
        this.message(JSON.stringify({ method: "twitter.event", params: {
          twAccount: account,
          eventType: "NEW_TWEET",
          content: { id: tweetId, text: "Test post.", createdAt: "2026-11-18T02:00:00Z" },
        } }));
      }
      if (this.number === 1) {
        setTimeout(() => {
          assert.ok(this.pings > 0);
          this.close(1006, token);
        }, 100);
      } else {
        setTimeout(() => process.exit(0), 100);
      }
    }

    close(code, reason) {
      this.readyState = FixtureSocket.CLOSING;
      this.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
    }
  }
  globalThis.WebSocket = FixtureSocket;
};

try {
  mkdirSync(join(cwd, ".signal-hub"));
  writeFileSync(join(cwd, ".signal-hub", "runtime-config.json"), JSON.stringify({ twitterAccounts: ["Alice"] }));
  writeFileSync(preload, 'import assert from "node:assert/strict";\n(' + fixture.toString() + ')(' + JSON.stringify({ id, token }) + ');\n');
  const result = spawnSync(process.execPath, [
    "--experimental-transform-types", "--import", pathToFileURL(preload).href, worker,
  ], {
    cwd, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, TWITTER_TOKEN: token, TWITTER_CONNECTOR_ENABLED: "false",
      X_6551_WS_ENABLED: "true", X_PIPELINE_DB: dbPath, TWITTER_WATCH_USERNAMES: "",
      TWITTER_WS_URL: "wss://ai.6551.io/open/twitter_wss" },
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.equal((result.stdout.match(/"event":"x_6551_subscribed"/g) || []).length, 2);
  assert.doesNotMatch(result.stdout + result.stderr, /test-only-token/);
  const db = new DatabaseSync(dbPath);
  try {
    assert.deepEqual(db.prepare("select id, first_source from x_feed").all().map(row => ({ ...row })), [{ id, first_source: "6551" }]);
    assert.equal(db.prepare("select status from x_health where scope = '6551-wss'").get().status, "live");
  } finally {
    db.close();
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - WSS subscribe, heartbeat, reconnect, allowlist and deduplicated writes");
