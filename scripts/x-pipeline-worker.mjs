import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  get6551TwitterToken,
  get6551TwitterWebSocketUrl,
  has6551TwitterToken,
  is6551TwitterConnectorEnabled,
  normalize6551RealtimeEvent,
} from "../src/lib/6551-twitter.ts";
import {
  getXPipelineConfiguredAccounts,
  getXPipelineConfiguredTruthAccounts,
} from "../src/lib/x-pipeline-accounts.ts";
import {
  getXPipelineConfig,
} from "../src/lib/x-pipeline-config.ts";
import {
  disableXPipelineAccountsExcept,
  setXPipelineHealth,
  upsertXPipelineAccount,
  upsertXPipelineRealtimeUpdate,
} from "../src/lib/x-pipeline-store.ts";

const RUNTIME_CONFIG_PATH = resolve(process.cwd(), ".signal-hub", "runtime-config.json");
const ACCOUNT_SYNC_INTERVAL_MS = 60_000;
const MAX_RECONNECT_MS = 30_000;

let reconnectAttempts = 0;
let reconnectTimer = null;
let accountSyncTimer = null;
let activeSocket = null;

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

function normalizeRuntimeConfig(raw) {
  const items = Array.isArray(raw?.twitterAccounts) ? raw.twitterAccounts : [];
  return {
    telegramChannels: [],
    twitterAccounts: items
      .map((item) => {
        if (typeof item === "string") {
          return { ref: item, tags: [] };
        }
        if (item && typeof item.ref === "string") {
          return {
            ref: item.ref,
            tags: Array.isArray(item.tags)
              ? item.tags.filter((tag) => typeof tag === "string")
              : [],
          };
        }
        return null;
      })
      .filter(Boolean),
  };
}

async function readRuntimeConfigFile() {
  try {
    return normalizeRuntimeConfig(JSON.parse(await readFile(RUNTIME_CONFIG_PATH, "utf8")));
  } catch {
    return { telegramChannels: [], twitterAccounts: [] };
  }
}

async function syncConfiguredAccounts() {
  const runtimeConfig = await readRuntimeConfigFile();
  const accounts = [
    ...getXPipelineConfiguredAccounts(runtimeConfig),
    ...getXPipelineConfiguredTruthAccounts(),
  ];
  for (const account of accounts) {
    upsertXPipelineAccount(account);
  }
  disableXPipelineAccountsExcept(accounts.map((account) => account.username));
  log("x_accounts_synced", { count: accounts.length });
  return accounts;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const maxAttempts = getXPipelineConfig().maxReconnectAttempts;
  if (reconnectAttempts >= maxAttempts) {
    markHealth(
      "error",
      `6551 websocket failed ${maxAttempts} times; check token plan or WS access`,
    );
    log("x_reconnect_stopped", { attempts: reconnectAttempts });
    return;
  }
  const delay = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectUpstream();
  }, delay);
}

function markHealth(status, detail) {
  setXPipelineHealth({ scope: "collector", status, detail });
}

function closeActiveSocket() {
  if (activeSocket && activeSocket.readyState < WebSocket.CLOSING) {
    activeSocket.close(1000, "restart");
  }
  activeSocket = null;
}

function connectUpstream() {
  if (!is6551TwitterConnectorEnabled()) {
    markHealth("paused", "TWITTER_CONNECTOR_ENABLED is paused");
    log("x_pipeline_paused");
    return;
  }

  if (!has6551TwitterToken()) {
    markHealth("needs_token", "TWITTER_TOKEN is not configured");
    log("x_pipeline_needs_token");
    return;
  }

  if (typeof WebSocket === "undefined") {
    markHealth("error", "Node WebSocket runtime is unavailable");
    log("x_pipeline_websocket_unavailable");
    return;
  }

  if (
    activeSocket &&
    (activeSocket.readyState === WebSocket.OPEN ||
      activeSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const webSocketUrl = new URL(get6551TwitterWebSocketUrl());
  webSocketUrl.searchParams.set("token", get6551TwitterToken());

  markHealth("connecting", "connecting to 6551 websocket");
  const socket = new WebSocket(webSocketUrl);
  activeSocket = socket;

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    markHealth("connected", "6551 websocket connected");
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "twitter.subscribe",
      }),
    );
    log("x_websocket_open");
  });

  socket.addEventListener("message", async (event) => {
    if (typeof event.data !== "string") return;

    try {
      const payload = JSON.parse(event.data);
      if (payload?.result?.success && payload.id === 1) {
        markHealth("subscribed", "6551 twitter.subscribe active");
        log("x_websocket_subscribed");
        return;
      }

      if (payload?.error?.message) {
        markHealth("error", String(payload.error.message));
        log("x_websocket_rpc_error", { error: String(payload.error.message) });
        return;
      }

      if (payload?.method === "twitter.event") {
        const update = await normalize6551RealtimeEvent(payload.params);
        if (!update) return;
        upsertXPipelineRealtimeUpdate(update);
        markHealth("live", `received ${update.eventType} from @${update.account}`);
        log("x_realtime_event", {
          account: update.account,
          eventType: update.eventType,
          id: update.feedItem.id,
        });
      }
    } catch (error) {
      markHealth("error", `failed to parse websocket message: ${String(error)}`);
      log("x_websocket_message_failed", { error: String(error) });
    }
  });

  socket.addEventListener("error", () => {
    markHealth("error", "6551 websocket error");
    log("x_websocket_error");
  });

  socket.addEventListener("close", (event) => {
    if (activeSocket === socket) {
      activeSocket = null;
    }
    markHealth("closed", `6551 websocket closed code=${event.code}`);
    log("x_websocket_closed", {
      code: event.code,
      clean: event.wasClean,
      reason: event.reason || "",
    });
    scheduleReconnect();
  });
}

async function main() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  await loadEnvFile(resolve(process.cwd(), ".env"));

  const once = process.argv.includes("--once");
  markHealth("starting", "X pipeline starting");
  await syncConfiguredAccounts();

  if (once) {
    markHealth("live", "X pipeline account sync completed");
    return;
  }

  accountSyncTimer = setInterval(() => {
    void syncConfiguredAccounts().catch((error) => {
      markHealth("error", `account sync failed: ${String(error)}`);
      log("x_account_sync_failed", { error: String(error) });
    });
  }, ACCOUNT_SYNC_INTERVAL_MS);

  connectUpstream();
}

process.on("SIGINT", () => {
  if (accountSyncTimer) clearInterval(accountSyncTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  closeActiveSocket();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (accountSyncTimer) clearInterval(accountSyncTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  closeActiveSocket();
  process.exit(0);
});

main().catch((error) => {
  markHealth("error", String(error));
  log("x_pipeline_worker_failed", { error: String(error) });
  process.exit(1);
});
