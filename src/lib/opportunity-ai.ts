import { createHash } from "node:crypto";
import {
  isQuotaExhaustedError,
  runWithAiProviderFallback,
  type AiProviderConfig,
} from "./ai-provider-fallback.ts";
import type { OpportunityCandidate } from "./opportunity-types.ts";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const OPPORTUNITY_PROMPT_VERSION = 1;
export const OPPORTUNITY_SYSTEM_PROMPT = `You classify investment information. Return JSON only.
Use only supplied evidence. Never invent facts, numbers, assets, or sources.
aiAdjustment must be an integer from -15 through 15.
Every conclusion must cite one or more supplied evidenceIds.
Do not raise an unverified single-source candidate above the display threshold.`;

export type OpportunityAiEvaluation = {
  canonicalKey: string;
  aiAdjustment: number;
  thesis: string;
  reasons: string[];
  risks: string[];
  invalidation: string[];
  validUntil: string | null;
  confidence: "low" | "medium" | "high";
  evidenceIds: string[];
};

export type OpportunityAiBatch = {
  opportunities: OpportunityAiEvaluation[];
};

export type OpportunityAiBatchResult =
  | {
      evaluations: OpportunityAiEvaluation[];
      provider: AiProviderConfig;
      inputHash: string;
      ruleOnly: false;
    }
  | {
      evaluations: [];
      provider: null;
      inputHash: null;
      ruleOnly: true;
    };

const OPPORTUNITY_KEYS = [
  "canonicalKey",
  "aiAdjustment",
  "thesis",
  "reasons",
  "risks",
  "invalidation",
  "validUntil",
  "confidence",
  "evidenceIds",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
) {
  const expectedKeys = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !expectedKeys.has(key));
  const missing = expected.filter((key) => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `${context} schema has unexpected or missing fields`,
    );
  }
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Opportunity AI ${field} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, field: string) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new Error(`Opportunity AI ${field} must be a string array`);
  }
  return value as string[];
}

function parseOpportunityAiItem(value: unknown): OpportunityAiEvaluation {
  if (!isRecord(value)) {
    throw new Error("Opportunity AI item must be an object");
  }
  assertExactKeys(value, OPPORTUNITY_KEYS, "Opportunity AI item");

  if (typeof value.aiAdjustment !== "number" || !Number.isFinite(value.aiAdjustment)) {
    throw new Error("Opportunity AI adjustment must be a finite number");
  }
  if (
    value.confidence !== "low" &&
    value.confidence !== "medium" &&
    value.confidence !== "high"
  ) {
    throw new Error("Opportunity AI confidence is invalid");
  }
  if (
    value.validUntil !== null &&
    (typeof value.validUntil !== "string" ||
      !Number.isFinite(Date.parse(value.validUntil)))
  ) {
    throw new Error("Opportunity AI validUntil must be a valid date or null");
  }

  return {
    canonicalKey: requiredString(value.canonicalKey, "canonicalKey"),
    aiAdjustment: value.aiAdjustment,
    thesis: requiredString(value.thesis, "thesis"),
    reasons: stringArray(value.reasons, "reasons"),
    risks: stringArray(value.risks, "risks"),
    invalidation: stringArray(value.invalidation, "invalidation"),
    validUntil: value.validUntil,
    confidence: value.confidence,
    evidenceIds: stringArray(value.evidenceIds, "evidenceIds"),
  };
}

export function buildOpportunityPrompt(candidates: OpportunityCandidate[]) {
  return JSON.stringify({
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
    candidates: candidates.map((candidate) => ({
      canonicalKey: candidate.canonicalKey,
      market: candidate.market,
      assetKeys: candidate.assetKeys,
      eventType: candidate.eventType,
      evidence: candidate.evidence.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt,
        text: (item.translation || item.text).slice(0, 2_000),
      })),
    })),
    responseShape: {
      opportunities: [
        {
          canonicalKey: "string",
          aiAdjustment: 0,
          thesis: "string",
          reasons: ["string"],
          risks: ["string"],
          invalidation: ["string"],
          validUntil: null,
          confidence: "low|medium|high",
          evidenceIds: ["source:id"],
        },
      ],
    },
  });
}

export function buildOpportunityInputHash(
  candidates: OpportunityCandidate[],
  promptVersion: number,
) {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion, candidates }))
    .digest("hex");
}

export function parseOpportunityAiBatch(content: string): OpportunityAiBatch {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const parsed = JSON.parse(fenced?.[1] ?? trimmed) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Opportunity AI response must be an object");
  }
  assertExactKeys(parsed, ["opportunities"], "Opportunity AI response");
  if (!Array.isArray(parsed.opportunities)) {
    throw new Error("Opportunity AI response has no opportunities array");
  }
  return {
    opportunities: parsed.opportunities.map(parseOpportunityAiItem),
  };
}

export function validateOpportunityAiBatch(
  result: OpportunityAiBatch,
  evidenceByCluster: Map<string, Set<string>>,
) {
  const seenCanonicalKeys = new Set<string>();
  return result.opportunities.map((item) => {
    if (seenCanonicalKeys.has(item.canonicalKey)) {
      throw new Error(`Duplicate canonical key ${item.canonicalKey}`);
    }
    seenCanonicalKeys.add(item.canonicalKey);

    if (
      !Number.isInteger(item.aiAdjustment) ||
      item.aiAdjustment < -15 ||
      item.aiAdjustment > 15
    ) {
      throw new Error(`Invalid AI adjustment for ${item.canonicalKey}`);
    }

    const allowedEvidenceIds = evidenceByCluster.get(item.canonicalKey);
    if (
      !allowedEvidenceIds ||
      item.evidenceIds.length === 0 ||
      new Set(item.evidenceIds).size !== item.evidenceIds.length ||
      item.evidenceIds.some((id) => !allowedEvidenceIds.has(id))
    ) {
      throw new Error(`Invalid evidence IDs for ${item.canonicalKey}`);
    }
    return item;
  });
}

export function getOpportunityProviderCandidates(
  env: EnvLike = process.env,
): AiProviderConfig[] {
  const minimaxKey =
    env.MINIMAX_API_KEY?.trim() ||
    (/minimax/i.test(env.AI_SUMMARY_BASE_URL || "")
      ? env.AI_SUMMARY_API_KEY?.trim()
      : "") ||
    "";
  const deepseekKey =
    env.DEEPSEEK_API_KEY?.trim() ||
    env.AI_SUMMARY_FALLBACK_API_KEY?.trim() ||
    "";

  return [
    minimaxKey
      ? {
          id: "minimax",
          baseUrl: (env.MINIMAX_BASE_URL?.trim() || "https://api.minimaxi.com/v1").replace(
            /\/+$/,
            "",
          ),
          apiKey: minimaxKey,
          model: env.MINIMAX_MODEL?.trim() || "MiniMax-M2.7",
        }
      : null,
    deepseekKey
      ? {
          id: "deepseek",
          baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(
            /\/+$/,
            "",
          ),
          apiKey: deepseekKey,
          model: env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
        }
      : null,
  ].filter((provider): provider is AiProviderConfig => provider !== null);
}

function opportunityAiRuleOnlyResult(): OpportunityAiBatchResult {
  return {
    evaluations: [],
    provider: null,
    inputHash: null,
    ruleOnly: true,
  };
}

class OpportunityAiTerminalError extends Error {
  constructor() {
    super("Opportunity AI response validation failed");
    this.name = "OpportunityAiTerminalError";
  }
}

function isRetryableOpportunityAiError(error: unknown) {
  if (error instanceof OpportunityAiTerminalError) return false;
  if (isQuotaExhaustedError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\bHTTP (?:408|429|5\d\d)\b|timeout|fetch failed/i.test(
    message,
  );
}

function responseContent(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error("Opportunity AI response has no choices array");
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("Opportunity AI response has no message");
  }
  return requiredString(firstChoice.message.content, "response content");
}

export async function evaluateOpportunityBatch({
  candidates,
  env = process.env,
  fetchImpl = fetch,
}: {
  candidates: OpportunityCandidate[];
  env?: EnvLike;
  fetchImpl?: FetchLike;
}): Promise<OpportunityAiBatchResult> {
  const providers = getOpportunityProviderCandidates(env);
  if (providers.length === 0) return opportunityAiRuleOnlyResult();

  const evidenceByCluster = new Map(
    candidates.map((candidate) => [
      candidate.canonicalKey,
      new Set(candidate.evidence.map((item) => item.id)),
    ]),
  );
  const inputHash = buildOpportunityInputHash(
    candidates,
    OPPORTUNITY_PROMPT_VERSION,
  );

  try {
    const result = await runWithAiProviderFallback({
      providers,
      cooldownMs: 60 * 60 * 1_000,
      shouldFallback: isRetryableOpportunityAiError,
      request: async (provider) => {
        const response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: provider.model,
            temperature: 0.1,
            messages: [
              { role: "system", content: OPPORTUNITY_SYSTEM_PROMPT },
              { role: "user", content: buildOpportunityPrompt(candidates) },
            ],
          }),
        });
        if (!response.ok) {
          throw new Error(`Opportunity AI HTTP ${response.status}`);
        }
        try {
          const content = responseContent(await response.json());
          return validateOpportunityAiBatch(
            parseOpportunityAiBatch(content),
            evidenceByCluster,
          );
        } catch {
          throw new OpportunityAiTerminalError();
        }
      },
    });

    return {
      evaluations: result.value,
      provider: result.provider,
      inputHash,
      ruleOnly: false,
    };
  } catch {
    return opportunityAiRuleOnlyResult();
  }
}
