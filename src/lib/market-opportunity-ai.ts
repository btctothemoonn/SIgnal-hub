import {
  getAlphaSummaryProviderCandidates,
  isMiniMaxBaseUrl,
} from "./alpha-summary.ts";
import {
  runWithAiProviderFallback,
  type AiProviderConfig,
} from "./ai-provider-fallback.ts";
import type { MarketOpportunityDecision } from "./market-opportunity-core.ts";
import type {
  MarketOpportunityAiItem,
  OpportunityAiPolicy,
} from "./market-alerts-store.ts";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type MarketOpportunityAiResult = {
  status: "generated" | "failed" | "skipped";
  items: MarketOpportunityAiItem[] | null;
  provider: string | null;
  generatedAt: string | null;
  error: string | null;
  reason: OpportunityAiPolicy["reason"] | null;
};

const inFlightByFingerprint = new Map<
  string,
  Promise<MarketOpportunityAiResult>
>();

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function providerError(payload: Record<string, unknown>, status: number) {
  const error = payload.error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as Record<string, unknown>).message);
  }
  return `Market opportunity AI HTTP ${status}`;
}

function findJsonObjectEnd(content: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index + 1;
  }
  return -1;
}

function cleanJson(content: string) {
  const cleaned = content
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const itemsKey = cleaned.search(/"items"\s*:/);
  const start = itemsKey >= 0 ? cleaned.lastIndexOf("{", itemsKey) : cleaned.indexOf("{");
  if (start < 0) return cleaned;
  const end = findJsonObjectEnd(cleaned, start);
  return end > start ? cleaned.slice(start, end) : cleaned;
}

function cleanField(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 400) : "";
}

function containsProhibitedAdvice(item: MarketOpportunityAiItem) {
  const text = Object.values(item).join(" ");
  return /(?:\b\d+(?:\.\d+)?x\b|杠杆|全仓|半仓|仓位\s*\d|立即开仓|直接开仓|马上开仓|下单|市价单|限价单|position\s+size|place\s+(?:an?\s+)?order|leverage)/i.test(
    text,
  );
}

function parseItems(
  content: string,
  decisions: MarketOpportunityDecision[],
) {
  const parsed = JSON.parse(cleanJson(content)) as Record<string, unknown>;
  const rows = Array.isArray(parsed.items) ? parsed.items : [];
  const expectedSymbols = decisions.map((decision) => decision.symbol.toUpperCase());
  if (rows.length !== expectedSymbols.length) {
    throw new Error("Market opportunity AI returned invalid item count");
  }
  const bySymbol = new Map<string, MarketOpportunityAiItem>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Market opportunity AI returned invalid JSON item");
    }
    const record = row as Record<string, unknown>;
    const item: MarketOpportunityAiItem = {
      symbol: cleanField(record.symbol).toUpperCase(),
      summary: cleanField(record.summary),
      rationale: cleanField(record.rationale),
      confirmation: cleanField(record.confirmation),
      invalidation: cleanField(record.invalidation),
      risk: cleanField(record.risk),
      validFor: cleanField(record.validFor),
    };
    if (
      !expectedSymbols.includes(item.symbol) ||
      bySymbol.has(item.symbol) ||
      Object.values(item).some((value) => !value)
    ) {
      throw new Error("Market opportunity AI returned invalid JSON fields");
    }
    if (containsProhibitedAdvice(item)) {
      throw new Error("Market opportunity AI returned prohibited trading advice");
    }
    bySymbol.set(item.symbol, item);
  }
  return expectedSymbols.map((symbol) => {
    const item = bySymbol.get(symbol);
    if (!item) throw new Error(`Market opportunity AI omitted ${symbol}`);
    return item;
  });
}

async function generate(input: {
  decisions: MarketOpportunityDecision[];
  providers: AiProviderConfig[];
  fetchImpl: FetchLike;
  now: Date;
}): Promise<MarketOpportunityAiResult> {
  if (!input.providers.length) {
    return {
      status: "failed",
      items: null,
      provider: null,
      generatedAt: input.now.toISOString(),
      error: "No AI provider configured",
      reason: null,
    };
  }
  const rulePayload = input.decisions.map((decision) => ({
    symbol: decision.symbol,
    model: decision.model,
    direction: decision.direction,
    stage: decision.stage,
    decision: decision.decision,
    score: decision.score,
    confidence: decision.confidence,
    evidence: decision.evidence,
    confirmations: decision.confirmations,
    invalidations: decision.invalidations,
    risks: decision.risks,
    observedAt: decision.observedAt,
    expiresAt: decision.expiresAt,
    metrics: decision.metrics,
  }));
  const prompt = [
    "仅解释下面规则引擎已选出的合约机会，不得改变 symbol、方向、阶段、决策或分数。",
    "不得建议杠杆倍数、仓位比例、立即开仓或下单。不得补充输入中不存在的市场事实。",
    "返回 JSON：{\"items\":[{\"symbol\":\"...\",\"summary\":\"一句话决策\",\"rationale\":\"规则依据\",\"confirmation\":\"仍需确认\",\"invalidation\":\"失效条件\",\"risk\":\"主要风险\",\"validFor\":\"剩余有效期\"}]}。",
    "每个输入 symbol 必须且只能返回一次。",
    JSON.stringify(rulePayload),
  ].join("\n");

  try {
    const generated = await runWithAiProviderFallback({
      providers: input.providers,
      request: async (provider) => {
        const response = await input.fetchImpl(
          `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${provider.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: provider.model,
              messages: [
                {
                  role: "system",
                  content: "You explain deterministic market rules without changing their decision.",
                },
                { role: "user", content: prompt },
              ],
              temperature: 0.1,
              ...(isMiniMaxBaseUrl(provider.baseUrl)
                ? {}
                : { response_format: { type: "json_object" } }),
            }),
            signal: AbortSignal.timeout(45_000),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!response.ok) {
          throw new Error(providerError(payload, response.status));
        }
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const message = (choices[0] as Record<string, unknown> | undefined)
          ?.message as Record<string, unknown> | undefined;
        const content = typeof message?.content === "string" ? message.content : "";
        if (!content) throw new Error("Market opportunity AI returned empty content");
        return parseItems(content, input.decisions);
      },
    });
    return {
      status: "generated",
      items: generated.value,
      provider: generated.provider.id,
      generatedAt: input.now.toISOString(),
      error: null,
      reason: null,
    };
  } catch (error) {
    return {
      status: "failed",
      items: null,
      provider: null,
      generatedAt: input.now.toISOString(),
      error: errorMessage(error),
      reason: null,
    };
  }
}

export function explainMarketOpportunities(input: {
  decisions: MarketOpportunityDecision[];
  fingerprint: string;
  policy: OpportunityAiPolicy;
  providers?: AiProviderConfig[];
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<MarketOpportunityAiResult> {
  if (!input.policy.allowed || input.decisions.length === 0) {
    return Promise.resolve({
      status: "skipped",
      items: null,
      provider: null,
      generatedAt: null,
      error: null,
      reason: input.policy.reason,
    });
  }
  const existing = inFlightByFingerprint.get(input.fingerprint);
  if (existing) return existing;

  const request = generate({
    decisions: input.decisions,
    providers: input.providers ?? getAlphaSummaryProviderCandidates(input.env),
    fetchImpl: input.fetchImpl ?? fetch,
    now: input.now ?? new Date(),
  }).finally(() => {
    inFlightByFingerprint.delete(input.fingerprint);
  });
  inFlightByFingerprint.set(input.fingerprint, request);
  return request;
}
