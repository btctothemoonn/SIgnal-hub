import type { openMarketAlertsStore } from "./market-alerts-store.ts";

type MarketAlertEvent = ReturnType<
  ReturnType<typeof openMarketAlertsStore>["insertMarketAlertEvent"]
>;
type EnvLike = Record<string, string | undefined>;
type FetchLike = (
  input: string | URL,
  init?: { method?: string; body?: URLSearchParams; signal?: AbortSignal },
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export class MarketAlertDeliveryError extends Error {
  uncertain: boolean;

  constructor(message: string, options: { uncertain: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "MarketAlertDeliveryError";
    this.uncertain = options.uncertain;
  }
}

export function isUncertainMarketAlertDeliveryError(error: unknown) {
  return error instanceof MarketAlertDeliveryError && error.uncertain;
}

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function signedPercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number.toFixed(2)}%` : "N/A";
}

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  if (Math.abs(number) >= 1_000) return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${number.toPrecision(6)}`;
}

export function formatMarketAlertTelegram(event: MarketAlertEvent) {
  const metrics = event.metrics ?? {};
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.occurredAt));
  const lines = [
    `${event.symbol} ${event.stage} · L${event.level}`,
    `${time} | ${event.trigger}`,
    `价格 ${money(event.price)} | 24h ${signedPercent(metrics.pct24h)}`,
  ];
  if (event.type === "short_squeeze") {
    lines.push(
      `15m ${signedPercent(metrics.priceChange15m)} | OI ${signedPercent(metrics.oiGrowth15m)}`,
      `资金费率 ${signedPercent(Number(metrics.funding) * 100)} | 评分 ${event.score ?? 0}`,
    );
  } else {
    lines.push(
      `近25m ${signedPercent(event.changePct)} | 量比 ${(event.volumeRatio ?? 0).toFixed(2)}x`,
    );
  }
  if (event.reasons.length) lines.push(`触发：${event.reasons.join("、")}`);
  return lines.join("\n").slice(0, 3900);
}

export function createMarketAlertDeliverer(options: {
  env?: EnvLike;
  fetchImpl?: FetchLike;
} = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const isEnabled = enabled(env.MARKET_ALERTS_TELEGRAM_ENABLED);
  return async (event: MarketAlertEvent) => {
    if (!isEnabled) return { status: "disabled" as const, messageId: null };
    const isSqueeze = event.type === "short_squeeze";
    const token = isSqueeze
      ? env.SQUEEZE_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN
      : env.TELEGRAM_BOT_TOKEN;
    const chatId = isSqueeze
      ? env.SQUEEZE_TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID
      : env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new MarketAlertDeliveryError(
        isSqueeze
          ? "missing SQUEEZE_TELEGRAM_BOT_TOKEN or SQUEEZE_TELEGRAM_CHAT_ID"
          : "missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID",
        { uncertain: false },
      );
    }
    const body = new URLSearchParams({
      chat_id: chatId,
      text: formatMarketAlertTelegram(event),
      disable_web_page_preview: "true",
    });
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new MarketAlertDeliveryError("Telegram delivery result is uncertain", {
        uncertain: true,
        cause: error,
      });
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch (error) {
      throw new MarketAlertDeliveryError("Telegram delivery response was unreadable", {
        uncertain: response.ok,
        cause: error,
      });
    }
    if (!response.ok || !result || typeof result !== "object" || !("ok" in result) || !result.ok) {
      const description =
        result && typeof result === "object" && "description" in result
          ? String(result.description)
          : `HTTP ${response.status ?? "unknown"}`;
      throw new MarketAlertDeliveryError(
        `Telegram delivery failed: ${description.replaceAll(token, "[REDACTED]")}`,
        { uncertain: false },
      );
    }
    const resultRecord = result as Record<string, unknown>;
    const telegramResult =
      resultRecord.result && typeof resultRecord.result === "object"
        ? (resultRecord.result as Record<string, unknown>)
        : {};
    const messageId = Number(telegramResult.message_id);
    return {
      status: "sent" as const,
      messageId: Number.isInteger(messageId) ? messageId : null,
    };
  };
}
