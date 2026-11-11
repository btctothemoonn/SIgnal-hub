import { getAlphaSummaryProviderCandidates } from "./alpha-summary.ts";
import { runWithAiProviderFallback, type AiProviderConfig } from "./ai-provider-fallback.ts";
import type { EnvLike } from "./important-push-types.ts";
import type { MarketSignal } from "./market-signals.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SignalNoteContext = {
  signal: MarketSignal;
  recentEvents: Array<{ occurredAt: string; stage: string; level: number; changePct: number | null }>;
};

const PROHIBITED = /(杠杆|全仓|半仓|仓位|开仓|下单|买入|卖出|做多|做空|抄底|止盈|建议|应该|必涨|必跌|leverage|position size|buy|sell)/i;

function payloadFor(context: SignalNoteContext) {
  const { signal } = context;
  return {
    symbol: signal.symbol.replace(/USDT$/, ""),
    signal: signal.kind === "pullback_long" ? "暴涨后回调到位" : "OI 大增但价格未动（蓄力观察）",
    signalAt: signal.signalAt,
    refPrice: signal.refPrice,
    detail: signal.detail,
    recentEvents: context.recentEvents.slice(0, 12),
  };
}

// Numbers in the sentence must appear in the input; anything else is treated as invented.
function numbersAreGrounded(sentence: string, input: string) {
  const numbers = sentence.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((value) => input.includes(value));
}

export function cleanSignalNote(content: string, input: string) {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/[`*#>]/g, "")
    .trim()
    .split(/\n+/)[0]
    ?.trim() ?? "";
  if (!text || text.length > 80) return null;
  if (PROHIBITED.test(text)) return null;
  if (!numbersAreGrounded(text, input)) return null;
  return text;
}

export async function generateSignalNote(input: {
  context: SignalNoteContext;
  providers?: AiProviderConfig[];
  fetchImpl?: FetchLike;
  env?: EnvLike;
}): Promise<string | null> {
  const providers = input.providers ?? getAlphaSummaryProviderCandidates(input.env);
  if (!providers.length) return null;
  const fetchImpl = input.fetchImpl ?? fetch;
  const payload = JSON.stringify(payloadFor(input.context));
  const prompt = [
    "用一句中文（不超过 40 个字）客观描述下面这个行情信号出现时的背景。",
    "只能使用输入里的事实和数字，不得补充其他市场信息，不得给出买卖、杠杆、仓位或任何操作建议，不要预测涨跌。",
    "只输出这一句话，不要解释。",
    payload,
  ].join("\n");
  const generated = await runWithAiProviderFallback({
    providers,
    request: async (provider) => {
      const response = await fetchImpl(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: "You describe market facts in one neutral Chinese sentence." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 200,
          ...(provider.model === "MiniMax-M3" ? { thinking: { type: "disabled" }, reasoning_split: true } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(`Signal note AI HTTP ${response.status}`);
      const choices = Array.isArray(body.choices) ? body.choices : [];
      const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
      const content = typeof message?.content === "string" ? message.content : "";
      const note = cleanSignalNote(content, payload);
      if (!note) throw new Error("Signal note AI returned an unusable sentence");
      return note;
    },
  });
  return generated.value;
}
