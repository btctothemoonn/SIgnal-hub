
import { existsSync } from "node:fs";
import {
  get6551TwitterToken,
  get6551TwitterWebSocketUrl,
  normalize6551PushedTweet,
} from "../src/lib/6551-twitter.ts";
import { loadRuntimeConfig } from "../src/lib/runtime-config.ts";
import { getXPipelineConfiguredAccounts } from "../src/lib/x-pipeline-accounts.ts";
import { getXPipelineConfig, isX6551WsEnabled } from "../src/lib/x-pipeline-config.ts";
import { setXPipelineHealth, upsertXPipelineRealtimeUpdate } from "../src/lib/x-pipeline-store.ts";
import { backfillMissingXTranslations } from "../src/lib/x-translation-backfill.ts";

const MAX_RECONNECT_MS = 60_000;
const SUBSCRIBE_TIMEOUT_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const SUBSCRIBE_ID = 1;

let reconnectAttempts = 0;
let reconnectTimer;
let activeSocket;
let stopping = false;
const pendingTranslations = new Set();
let activeTranslations = 0;

function drainTranslations() {
  while (!stopping && activeTranslations < 2 && pendingTranslations.size) {
    const id = pendingTranslations.values().next().value;
    pendingTranslations.delete(id);
    activeTranslations++;
    void backfillMissingXTranslations({ feedId: id, limit: 1 })
      .then(stats => { if (stats.attempted) log("x_6551_translation", { id, ...stats }); })
      .catch(() => log("x_6551_translation_error", { id }))
      .finally(() => { activeTranslations--; drainTranslations(); });
  }
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

function markHealth(status, detail) {
  setXPipelineHealth({ scope: "6551-wss", status, detail });
}

function scheduleReconnect(url) {
  const exponent = Math.min(reconnectAttempts++, getXPipelineConfig().maxReconnectAttempts);
  const delay = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** exponent);
  reconnectTimer = setTimeout(() => connectUpstream(url), delay);
}

function connectUpstream(url) {
  markHealth("connecting", "connecting to 6551 websocket");
  const socket = new WebSocket(url);
  activeSocket = socket;
  let subscribed = false;
  let waitingForPong = false;
  let heartbeat;
  const once = process.argv.includes("--once");
  const deadline = setTimeout(() => {
    log("x_6551_subscribe_timeout");
    socket.close(4000, "subscribe timeout");
  }, SUBSCRIBE_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: SUBSCRIBE_ID, method: "twitter.subscribe" }));
  });

  socket.addEventListener("message", async ({ data }) => {
    if (stopping || typeof data !== "string") return;
    if (data === "pong") {
      waitingForPong = false;
      return;
    }

    try {
      const payload = JSON.parse(data);
      if (!subscribed && payload?.id === SUBSCRIBE_ID) {
        if (payload.result?.success !== true) {
          log("x_6551_subscribe_rejected");
          socket.close(4001, "subscription rejected");
          return;
        }
        subscribed = true;
        reconnectAttempts = 0;
        clearTimeout(deadline);
        markHealth("subscribed", "6551 twitter.subscribe active");
        log("x_6551_subscribed");
        if (once) {
          socket.close(1000, "subscription verified");
          return;
        }
        heartbeat = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (waitingForPong) {
            log("x_6551_heartbeat_timeout");
            socket.close(4002, "heartbeat timeout");
            return;
          }
          waitingForPong = true;
          socket.send("ping");
        }, HEARTBEAT_INTERVAL_MS);
        return;
      }
      if (!subscribed || once || payload?.method !== "twitter.event") return;
      const update = normalize6551PushedTweet(payload.params);
      if (!update) return;
      const runtime = await loadRuntimeConfig();
      const allowed = getXPipelineConfiguredAccounts(runtime).some(
        ({ username }) => username.toLowerCase() === update.account.toLowerCase(),
      );
      if (!allowed || stopping || activeSocket !== socket) return;
      upsertXPipelineRealtimeUpdate(update);
      if (pendingTranslations.size < 512) pendingTranslations.add(update.feedItem.id);
      drainTranslations();
      markHealth("live", "received a tweet from 6551");
      log("x_6551_tweet_observed", { id: update.feedItem.id, eventType: update.eventType });
    } catch {
      // Error objects and close reasons can contain the token-bearing URL or raw payload.
      log("x_6551_message_failed");
    }
  });

  socket.addEventListener("error", () => log("x_6551_websocket_error"));
  socket.addEventListener("close", ({ code }) => {
    clearTimeout(deadline);
    clearInterval(heartbeat);
    activeSocket = undefined;
    if (stopping) return;
    if (once && subscribed) return;
    markHealth("closed", "6551 websocket closed, code=" + code);
    log("x_6551_websocket_closed", { code });
    if (once) process.exitCode = 1;
    else scheduleReconnect(url);
  });
}

function stop() {
  stopping = true;
  clearTimeout(reconnectTimer);
  if (activeSocket?.readyState < WebSocket.CLOSING) {
    activeSocket.close(1000, "shutdown");
  }
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  for (const path of [".env.local", ".env"]) {
    if (existsSync(path)) process.loadEnvFile(path);
  }
  if (isX6551WsEnabled()) {
    const token = get6551TwitterToken();
    const url = new URL(get6551TwitterWebSocketUrl());
    if (!token || url.protocol !== "wss:") throw new Error("Invalid 6551 WSS configuration");
    url.searchParams.set("token", token);
    connectUpstream(url);
  } else {
    log("x_6551_paused");
  }
} catch {
  log("x_6551_startup_failed");
  process.exitCode = 1;
}
