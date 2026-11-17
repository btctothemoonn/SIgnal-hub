import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { openEqnNewsStore } = await import("./eqn-news-store.ts");
const { normalizeEqnNews } = await import("./eqn-news-core.ts");
const { runEqnNewsWorker, startEqnNewsSocket, eqnReconnectDelay } = await import("./eqn-news-worker.ts");
assert.equal(eqnReconnectDelay(0, 1006, () => 0), 1000);
assert.equal(eqnReconnectDelay(1, 1006, () => 0), 2000);
assert.equal(eqnReconnectDelay(10, 1008, () => 0), 30000);
assert.equal(eqnReconnectDelay(0, 1013, () => 0), 30000);
const directory = mkdtempSync(join(tmpdir(), "eqn-news-worker-"));
const store = openEqnNewsStore(join(directory, "news.sqlite"));
try {
  let requests = 0;
  const disabled = await runEqnNewsWorker({ enabled: false, once: true, store, client: { listNews() { requests++; throw new Error(); } } });
  assert.equal(disabled.enabled, false);
  assert.equal(requests, 0, "disabled worker never contacts upstream");
  class Socket extends EventEmitter {
    readyState = 1; sent = [];
    addEventListener(name, fn) { this.on(name, fn); }
    removeEventListener(name, fn) { this.off(name, fn); }
    send(text) { this.sent.push(text); }
    close(code = 1000) { this.readyState = 3; this.emit("close", { code }); }
  }
  const sockets = []; const timers = new Map(); let seq = 0; let reconnects = 0;
  const stop = startEqnNewsSocket({ store, createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; }, onReconnect: () => { reconnects++; },
    timers: { setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearTimeout: (id) => timers.delete(id), setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearInterval: (id) => timers.delete(id) }, random: () => 0 });
  sockets[0].emit("open");
  assert.equal(reconnects, 1);
  const heartbeat = [...timers.values()].find((timer) => timer.ms === 30000);
  heartbeat.fn();
  assert.equal(sockets[0].sent.at(-1), "ping");
  sockets[0].emit("message", { data: "pong" });
  sockets[0].emit("message", { data: "bad-json" });
  sockets[0].emit("message", { data: JSON.stringify({ timestamp: 1794826821, news_title: "socket story", source_name: "BWENEWS", coins_included: [], url: "https://example.com/ws" }) });
  assert.equal(store.feed({}).items[0].title, "socket story");
  sockets[0].close(1013);
  assert.ok([...timers.values()].some((timer) => timer.ms === 30000), "overload close schedules backoff");
  stop();
  assert.equal(timers.size, 0, "socket shutdown clears heartbeat and reconnect timers");
  const doctorCalls = [];
  const doctor = await runEqnNewsWorker({ enabled: true, doctor: true, store, client: {
    listNews: async (args) => { doctorCalls.push(args); return { items: [{ no: 88, time: new Date().toISOString(), zh: "doctor record", channels: ["main"], source: "official" }], next_cursor: "much-more-history" }; },
    getNews: async () => ({ no: 88, time: new Date().toISOString(), zh: "doctor record", channels: ["main"], source: "official", body: null }),
  } });
  assert.equal(doctor.error, null, "doctor verifies connectivity without declaring partial historical catch-up unhealthy");
  assert.equal(doctorCalls[0].limit, 1);
  const result = await runEqnNewsWorker({ enabled: true, once: true, channels: ["main"], store,
    client: { listNews: async () => ({ items: [{ no: 9, time: new Date().toISOString(), zh: "official story", coins: [], channels: ["main"], source: "official" }], next_cursor: null }), getNews: async () => { throw new Error("detail unavailable"); } } });
  assert.match(result.error, /detail/i);
  assert.equal(store.get("9").title, "official story", "optional detail failure cannot lose core news");
  const now = Date.now();
  for (let i = 0; i < 9; i++) {
    const item = normalizeEqnNews({ no: 100 + i, time: now - i * 1000, zh: "pending detail", channels: ["main"] }, "mcp");
    store.upsert(item);
    if (i < 8) store.setState(`detailRetry:${item.id}`, now + 60000);
  }
  assert.ok(store.pendingDetails(8, now).some(item => item.no === 108), "cooldown rows cannot consume the detail batch");
  const unit = readFileSync(new URL("../../deploy/systemd/signal-hub-eqn-news.service", import.meta.url), "utf8");
  assert.match(unit, /User=ubuntu/);
  assert.match(unit, /EQN_NEWS_ENABLED=false/);
  assert.match(unit, /eqn-news-worker\.mjs/);
  console.log("eqn-news worker enablement, WS heartbeat, backoff and shutdown tests passed");
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
