import {
  get6551TwitterToken,
  get6551TwitterWebSocketUrl,
  has6551TwitterToken,
  is6551TwitterConnectorEnabled,
  merge6551RealtimeUpdateIntoSnapshotCache,
  normalize6551RealtimeEvent,
  type TwitterRealtimeStatus,
} from "@/lib/6551-twitter";

type SendEvent = (event: string, payload: unknown) => void;

const IDLE_CLOSE_MS = 120_000;
const MAX_RECONNECT_MS = 30_000;

const clients = new Map<symbol, SendEvent>();

let upstream: WebSocket | null = null;
let lastStatus: TwitterRealtimeStatus | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

function makeStatus(
  state: TwitterRealtimeStatus["state"],
  message: string,
): TwitterRealtimeStatus {
  return {
    state,
    message,
    at: new Date().toISOString(),
  };
}

function sanitizeDiagnostic(message: string) {
  const token = get6551TwitterToken();
  return token ? message.replaceAll(token, "[redacted-token]") : message;
}

function getErrorDiagnostic(event: Event) {
  const error = (event as ErrorEvent).error;
  if (error instanceof Error && error.message) {
    return sanitizeDiagnostic(error.message);
  }

  const message = (event as ErrorEvent).message;
  return typeof message === "string" && message.trim()
    ? sanitizeDiagnostic(message.trim())
    : "";
}

function getCloseDiagnostic(event: CloseEvent) {
  const parts = [`code=${event.code}`, `clean=${event.wasClean ? "yes" : "no"}`];
  if (event.reason) {
    parts.push(`reason=${sanitizeDiagnostic(event.reason)}`);
  }
  return parts.join(", ");
}

function broadcast(event: string, payload: unknown) {
  for (const send of clients.values()) {
    send(event, payload);
  }
}

function setStatus(status: TwitterRealtimeStatus) {
  lastStatus = status;
  broadcast("status", status);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearIdleCloseTimer() {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
}

function closeUpstream() {
  clearReconnectTimer();
  if (upstream && upstream.readyState < WebSocket.CLOSING) {
    upstream.close(1000, "no local subscribers");
  }
  upstream = null;
}

function scheduleReconnect() {
  if (clients.size === 0 || reconnectTimer) {
    return;
  }

  const delay = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensure6551TwitterRealtimeUpstream();
  }, delay);
}

function scheduleIdleClose() {
  clearIdleCloseTimer();
  if (clients.size > 0) {
    return;
  }

  idleCloseTimer = setTimeout(() => {
    closeUpstream();
  }, IDLE_CLOSE_MS);
}

export function ensure6551TwitterRealtimeUpstream() {
  clearIdleCloseTimer();

  if (!is6551TwitterConnectorEnabled()) {
    setStatus(
      makeStatus("paused", "6551 X 推送已手动暂停，当前不会建立实时订阅连接。"),
    );
    return;
  }

  if (!has6551TwitterToken()) {
    setStatus(
      makeStatus("needs_token", "未配置 TWITTER_TOKEN，实时推送未启动。"),
    );
    return;
  }

  if (typeof WebSocket === "undefined") {
    setStatus(makeStatus("error", "当前 Node 运行时不支持 WebSocket。"));
    return;
  }

  if (
    upstream &&
    (upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  clearReconnectTimer();
  setStatus(makeStatus("connecting", "正在连接 6551 实时推送..."));

  const webSocketUrl = new URL(get6551TwitterWebSocketUrl());
  webSocketUrl.searchParams.set("token", get6551TwitterToken());

  const socket = new WebSocket(webSocketUrl);
  upstream = socket;

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    setStatus(makeStatus("connected", "6551 实时连接已建立。"));
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "twitter.subscribe",
      }),
    );
  });

  socket.addEventListener("message", async (event) => {
    if (typeof event.data !== "string") {
      return;
    }

    try {
      const payload = JSON.parse(event.data) as {
        id?: number;
        result?: { success?: boolean };
        method?: string;
        params?: unknown;
        error?: { message?: string };
      };

      if (payload.result?.success && payload.id === 1) {
        setStatus(makeStatus("subscribed", "已订阅 6551 实时事件。"));
        return;
      }

      if (payload.error?.message) {
        setStatus(makeStatus("error", payload.error.message));
        return;
      }

      if (payload.method === "twitter.event") {
        const normalized = await normalize6551RealtimeEvent(payload.params);
        if (normalized) {
          await merge6551RealtimeUpdateIntoSnapshotCache(normalized);
          broadcast("twitter-event", normalized);
        }
      }
    } catch {
      setStatus(
        makeStatus("error", "解析 6551 实时消息失败，已忽略该条数据。"),
      );
    }
  });

  socket.addEventListener("error", (event) => {
    const detail = getErrorDiagnostic(event);
    setStatus(
      makeStatus(
        "error",
        detail
          ? `6551 实时连接出现异常：${detail}。浏览器会自动重连。`
          : "6551 实时连接出现异常，浏览器会自动重连。",
      ),
    );
  });

  socket.addEventListener("close", (event) => {
    if (upstream === socket) {
      upstream = null;
    }
    setStatus(
      makeStatus(
        "closed",
        `6551 实时连接已关闭 (${getCloseDiagnostic(event)})。`,
      ),
    );
    scheduleReconnect();
  });
}

export function subscribe6551TwitterRealtime(send: SendEvent): () => void {
  const id = Symbol("twitter-realtime-client");
  clients.set(id, send);

  if (lastStatus) {
    send("status", lastStatus);
  }

  ensure6551TwitterRealtimeUpstream();

  return () => {
    clients.delete(id);
    scheduleIdleClose();
  };
}
