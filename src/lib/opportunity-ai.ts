import { createHash } from "node:crypto";
import {
  isQuotaExhaustedError,
  runWithAiProviderFallback,
  type AiProviderConfig,
} from "./ai-provider-fallback.ts";
import type { OpportunityCandidate } from "./opportunity-types.ts";
import { sanitizeOpportunityOriginalUrl } from "./opportunity-url.ts";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OpportunityAiTimer = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

// Task 5 must pair each candidate with the rule score computed before AI evaluation.
export type OpportunityAiInput = {
  candidate: OpportunityCandidate;
  ruleScore: number;
};

export const OPPORTUNITY_PROMPT_VERSION = 2;
export const OPPORTUNITY_DISPLAY_THRESHOLD = 75;
export const OPPORTUNITY_SYSTEM_PROMPT = `You classify investment information. Return JSON only.
Return exactly one opportunity for every supplied canonicalKey and no other opportunities.
Use only supplied evidence. Never invent facts, numbers, assets, or sources.
aiAdjustment must be an integer from -15 through 15.
The thesis and every reason, risk, and invalidation claim must cite one or more supplied evidenceIds.
Do not raise an unverified single-source candidate from below displayThreshold to displayThreshold or above.`;

export type OpportunityAiClaim = {
  text: string;
  evidenceIds: string[];
};

export type OpportunityAiResponseEvaluation = {
  canonicalKey: string;
  aiAdjustment: number;
  thesis: OpportunityAiClaim;
  reasons: OpportunityAiClaim[];
  risks: OpportunityAiClaim[];
  invalidation: OpportunityAiClaim[];
  validUntil: string | null;
  confidence: "low" | "medium" | "high";
};

export type OpportunityAiBatch = {
  opportunities: OpportunityAiResponseEvaluation[];
};

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
  claimEvidence: {
    thesis: string[];
    reasons: string[][];
    risks: string[][];
    invalidation: string[][];
  };
};

export type OpportunityProviderOutcomeCounters = {
  attempts: number;
  successes: number;
  failures: number;
  fallbacks: number;
};

export type OpportunityProviderTelemetry = {
  minimax: OpportunityProviderOutcomeCounters;
  deepseek: OpportunityProviderOutcomeCounters;
};

export type OpportunityAiBatchResult =
  | {
      evaluations: OpportunityAiEvaluation[];
      provider: AiProviderConfig;
      inputHash: string;
      ruleOnly: false;
      providerTelemetry: OpportunityProviderTelemetry;
    }
  | {
      evaluations: [];
      provider: null;
      inputHash: null;
      ruleOnly: true;
      providerTelemetry: OpportunityProviderTelemetry;
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
] as const;
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_ERROR_BODY_BYTES = 1_024;
const DEFAULT_TIMER: OpportunityAiTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

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
    throw new Error(`${context} schema has unexpected or missing fields`);
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

function parseOpportunityAiClaim(value: unknown, field: string): OpportunityAiClaim {
  if (!isRecord(value)) {
    throw new Error(`Opportunity AI ${field} claim must be an object`);
  }
  assertExactKeys(value, ["text", "evidenceIds"], `Opportunity AI ${field} claim`);
  return {
    text: requiredString(value.text, `${field}.text`),
    evidenceIds: stringArray(value.evidenceIds, `${field}.evidenceIds`),
  };
}

function parseOpportunityAiClaims(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw new Error(`Opportunity AI ${field} must be an array`);
  }
  if (field === "reasons" && value.length > 3) {
    throw new Error("Opportunity AI reasons must contain at most 3 claims");
  }
  return value.map((claim) => parseOpportunityAiClaim(claim, field));
}

function parseOpportunityAiItem(value: unknown): OpportunityAiResponseEvaluation {
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
    thesis: parseOpportunityAiClaim(value.thesis, "thesis"),
    reasons: parseOpportunityAiClaims(value.reasons, "reasons"),
    risks: parseOpportunityAiClaims(value.risks, "risks"),
    invalidation: parseOpportunityAiClaims(value.invalidation, "invalidation"),
    validUntil: value.validUntil,
    confidence: value.confidence,
  };
}

function independentSourceCount(candidate: OpportunityCandidate) {
  return new Set(
    candidate.evidence.map((item) => `${item.sourceType}:${item.sourceName}`),
  ).size;
}

function validatedRuleScore(ruleScore: number) {
  if (!Number.isFinite(ruleScore) || ruleScore < 0 || ruleScore > 100) {
    throw new Error("Opportunity AI ruleScore must be between 0 and 100");
  }
  return ruleScore;
}

export function buildOpportunityPrompt(
  inputs: OpportunityAiInput[],
  promptVersion = OPPORTUNITY_PROMPT_VERSION,
) {
  return JSON.stringify({
    promptVersion,
    displayThreshold: OPPORTUNITY_DISPLAY_THRESHOLD,
    candidates: inputs.map(({ candidate, ruleScore }) => ({
      canonicalKey: candidate.canonicalKey,
      market: candidate.market,
      assetKeys: candidate.assetKeys,
      eventType: candidate.eventType,
      ruleScore: validatedRuleScore(ruleScore),
      independentSourceCount: independentSourceCount(candidate),
      displayThreshold: OPPORTUNITY_DISPLAY_THRESHOLD,
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
          thesis: { text: "string", evidenceIds: ["source:id"] },
          reasons: [{ text: "string", evidenceIds: ["source:id"] }],
          risks: [{ text: "string", evidenceIds: ["source:id"] }],
          invalidation: [{ text: "string", evidenceIds: ["source:id"] }],
          validUntil: null,
          confidence: "low|medium|high",
        },
      ],
    },
  });
}

export function buildOpportunityInputHash(
  inputs: OpportunityAiInput[],
  promptVersion = OPPORTUNITY_PROMPT_VERSION,
) {
  const evidenceLinkability = inputs.map(({ candidate }) => ({
    canonicalKey: candidate.canonicalKey,
    evidence: candidate.evidence.map((item) => {
      const originalUrl = sanitizeOpportunityOriginalUrl(item.originalUrl);
      return {
        id: item.id,
        linkable: Boolean(originalUrl),
        originalUrl,
      };
    }),
  }));
  return createHash("sha256")
    .update(buildOpportunityPrompt(inputs, promptVersion))
    .update(JSON.stringify(evidenceLinkability))
    .digest("hex");
}

function extractFirstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return null;
}

export function parseOpportunityAiBatch(content: string): OpportunityAiBatch {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonContent = fenced?.[1] ?? extractFirstJsonObject(trimmed) ?? trimmed;
  const parsed = JSON.parse(jsonContent) as unknown;
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

function validateClaimEvidence(
  claim: OpportunityAiClaim,
  allowedEvidenceIds: Set<string>,
  context: string,
) {
  if (
    claim.evidenceIds.length === 0 ||
    new Set(claim.evidenceIds).size !== claim.evidenceIds.length ||
    claim.evidenceIds.some((id) => !allowedEvidenceIds.has(id))
  ) {
    throw new Error(`Invalid evidence IDs for ${context}`);
  }
}

export function validateOpportunityAiBatch(
  result: OpportunityAiBatch,
  inputs: OpportunityAiInput[],
): OpportunityAiEvaluation[] {
  const inputByCanonicalKey = new Map<string, OpportunityAiInput>();
  for (const input of inputs) {
    validatedRuleScore(input.ruleScore);
    if (inputByCanonicalKey.has(input.candidate.canonicalKey)) {
      throw new Error(`Duplicate input canonical key ${input.candidate.canonicalKey}`);
    }
    inputByCanonicalKey.set(input.candidate.canonicalKey, input);
  }

  const seenCanonicalKeys = new Set<string>();
  for (const item of result.opportunities) {
    if (seenCanonicalKeys.has(item.canonicalKey)) {
      throw new Error(`Duplicate canonical key ${item.canonicalKey}`);
    }
    seenCanonicalKeys.add(item.canonicalKey);
  }
  if (
    result.opportunities.length === 0 ||
    result.opportunities.length !== inputByCanonicalKey.size ||
    [...seenCanonicalKeys].some((key) => !inputByCanonicalKey.has(key)) ||
    [...inputByCanonicalKey.keys()].some((key) => !seenCanonicalKeys.has(key))
  ) {
    throw new Error("Opportunity AI batch is incomplete or has unexpected canonical keys");
  }

  return result.opportunities.map((item) => {
    const input = inputByCanonicalKey.get(item.canonicalKey);
    if (!input) {
      throw new Error(`Unexpected canonical key ${item.canonicalKey}`);
    }
    if (
      !Number.isInteger(item.aiAdjustment) ||
      item.aiAdjustment < -15 ||
      item.aiAdjustment > 15
    ) {
      throw new Error(`Invalid AI adjustment for ${item.canonicalKey}`);
    }

    const sourceCount = independentSourceCount(input.candidate);
    if (
      sourceCount <= 1 &&
      input.ruleScore < OPPORTUNITY_DISPLAY_THRESHOLD &&
      input.ruleScore + item.aiAdjustment >= OPPORTUNITY_DISPLAY_THRESHOLD
    ) {
      throw new Error(`Single-source candidate cannot cross display threshold: ${item.canonicalKey}`);
    }

    const linkableEvidenceIds = new Set(
      input.candidate.evidence
        .filter((evidence) => Boolean(sanitizeOpportunityOriginalUrl(evidence.originalUrl)))
        .map((evidence) => evidence.id),
    );
    const claims = [
      item.thesis,
      ...item.reasons,
      ...item.risks,
      ...item.invalidation,
    ];
    claims.forEach((claim, index) => {
      validateClaimEvidence(claim, linkableEvidenceIds, `${item.canonicalKey}:${index}`);
    });
    const aggregateEvidenceIds = [
      ...new Set(claims.flatMap((claim) => claim.evidenceIds)),
    ];

    return {
      canonicalKey: item.canonicalKey,
      aiAdjustment: item.aiAdjustment,
      thesis: item.thesis.text,
      reasons: item.reasons.map((claim) => claim.text),
      risks: item.risks.map((claim) => claim.text),
      invalidation: item.invalidation.map((claim) => claim.text),
      validUntil: item.validUntil,
      confidence: item.confidence,
      evidenceIds: aggregateEvidenceIds,
      claimEvidence: {
        thesis: [...item.thesis.evidenceIds],
        reasons: item.reasons.map((claim) => [...claim.evidenceIds]),
        risks: item.risks.map((claim) => [...claim.evidenceIds]),
        invalidation: item.invalidation.map((claim) => [...claim.evidenceIds]),
      },
    };
  });
}

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function matchesProvider(baseUrl: string, provider: "minimax" | "deepseek") {
  try {
    const hostnameLabels = new URL(baseUrl).hostname.toLowerCase().split(".");
    return provider === "minimax"
      ? hostnameLabels.includes("minimax") || hostnameLabels.includes("minimaxi")
      : hostnameLabels.includes("deepseek");
  } catch {
    return false;
  }
}

export function getOpportunityProviderCandidates(
  env: EnvLike = process.env,
): AiProviderConfig[] {
  const providers: AiProviderConfig[] = [];
  const directMinimaxKey = env.MINIMAX_API_KEY?.trim() || "";
  const directMinimaxBaseUrl = env.MINIMAX_BASE_URL?.trim() || "";
  const summaryBaseUrl = env.AI_SUMMARY_BASE_URL?.trim() || "";
  const summaryIsMinimax =
    Boolean(summaryBaseUrl) && matchesProvider(summaryBaseUrl, "minimax");
  const summaryMinimaxKey = summaryIsMinimax
      ? env.AI_SUMMARY_API_KEY?.trim() || ""
      : "";
  const minimaxKey = directMinimaxKey || summaryMinimaxKey;
  if (minimaxKey) {
    const usesSummaryConfiguration = !directMinimaxBaseUrl && summaryIsMinimax;
    providers.push({
      id: "minimax",
      baseUrl: normalizedBaseUrl(
        usesSummaryConfiguration
          ? summaryBaseUrl
          : directMinimaxBaseUrl || "https://api.minimaxi.com/v1",
      ),
      apiKey: minimaxKey,
      model:
        env.MINIMAX_MODEL?.trim() ||
        (usesSummaryConfiguration ? env.AI_SUMMARY_MODEL?.trim() : "") ||
        "MiniMax-M2.7",
    });
  }

  const directDeepseekKey = env.DEEPSEEK_API_KEY?.trim() || "";
  const fallbackBaseUrl =
    env.AI_SUMMARY_FALLBACK_BASE_URL?.trim() || "https://api.deepseek.com";
  const summaryDeepseekKey = matchesProvider(fallbackBaseUrl, "deepseek")
    ? env.AI_SUMMARY_FALLBACK_API_KEY?.trim() || ""
    : "";
  const deepseekKey = directDeepseekKey || summaryDeepseekKey;
  if (deepseekKey) {
    const reusedSummaryProvider = !directDeepseekKey && Boolean(summaryDeepseekKey);
    providers.push({
      id: "deepseek",
      baseUrl: normalizedBaseUrl(
        reusedSummaryProvider
          ? fallbackBaseUrl
          : env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
      ),
      apiKey: deepseekKey,
      model: reusedSummaryProvider
        ? env.AI_SUMMARY_FALLBACK_MODEL?.trim() || "deepseek-chat"
        : env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    });
  }

  return providers;
}

function emptyProviderTelemetry(): OpportunityProviderTelemetry {
  return {
    minimax: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
    deepseek: { attempts: 0, successes: 0, failures: 0, fallbacks: 0 },
  };
}

function providerCounters(
  telemetry: OpportunityProviderTelemetry,
  providerId: string,
) {
  return providerId === "minimax" || providerId === "deepseek"
    ? telemetry[providerId]
    : null;
}

function incrementCounter(
  counters: OpportunityProviderOutcomeCounters | null,
  key: keyof OpportunityProviderOutcomeCounters,
) {
  if (counters) counters[key] = Math.min(100, counters[key] + 1);
}

function opportunityAiRuleOnlyResult(
  providerTelemetry = emptyProviderTelemetry(),
): OpportunityAiBatchResult {
  return {
    evaluations: [],
    provider: null,
    inputHash: null,
    ruleOnly: true,
    providerTelemetry,
  };
}

class OpportunityAiTerminalError extends Error {
  constructor() {
    super("Opportunity AI response validation failed");
    this.name = "OpportunityAiTerminalError";
  }
}

class OpportunityAiHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number) {
    const code = status === 429 ? "rate_limited" : `http_${status}`;
    super(`Opportunity AI HTTP ${status} (${code})`);
    this.name = "OpportunityAiHttpError";
    this.status = status;
    this.code = code;
  }
}

class OpportunityAiTimeoutError extends Error {
  constructor() {
    super("Opportunity AI request timeout");
    this.name = "OpportunityAiTimeoutError";
  }
}

class OpportunityAiQuotaError extends Error {
  readonly code = "quota_exhausted";

  constructor() {
    super("Opportunity AI quota exhausted");
    this.name = "OpportunityAiQuotaError";
  }
}

function isRetryableOpportunityAiError(error: unknown) {
  if (error instanceof OpportunityAiTerminalError) return false;
  if (error instanceof OpportunityAiTimeoutError) return true;
  if (error instanceof OpportunityAiQuotaError) return true;
  if (error instanceof OpportunityAiHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (isQuotaExhaustedError(error)) return true;
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (/^(?:ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT_TIMEOUT)$/i.test(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\bHTTP (?:408|429|5\d\d)\b|timeout|fetch failed/i.test(message);
}

async function readResponseBodyForClassification(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const bytes = new Uint8Array(MAX_ERROR_BODY_BYTES);
  let length = 0;
  try {
    while (length < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, MAX_ERROR_BODY_BYTES - length);
      bytes.set(value.subarray(0, take), length);
      length += take;
      if (take < value.byteLength || length === MAX_ERROR_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
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

function boundedTimeout(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(value)));
}

function configuredTimeout(env: EnvLike) {
  const raw =
    env.OPPORTUNITY_AI_TIMEOUT_MS?.trim() ||
    env.AI_SUMMARY_TIMEOUT_MS?.trim() ||
    "";
  return raw ? boundedTimeout(Number(raw), DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
}

export async function evaluateOpportunityBatch({
  inputs,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs,
  timer = DEFAULT_TIMER,
}: {
  inputs: OpportunityAiInput[];
  env?: EnvLike;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  timer?: OpportunityAiTimer;
}): Promise<OpportunityAiBatchResult> {
  const providers = getOpportunityProviderCandidates(env);
  if (providers.length === 0) return opportunityAiRuleOnlyResult();
  const providerTelemetry = emptyProviderTelemetry();

  try {
    const prompt = buildOpportunityPrompt(inputs);
    const inputHash = buildOpportunityInputHash(inputs);
    const requestTimeoutMs = boundedTimeout(timeoutMs, configuredTimeout(env));

    const result = await runWithAiProviderFallback({
      providers,
      cooldownMs: 60 * 60 * 1_000,
      shouldFallback: isRetryableOpportunityAiError,
      request: async (provider) => {
        const counters = providerCounters(providerTelemetry, provider.id);
        incrementCounter(counters, "attempts");
        if (providers.indexOf(provider) > 0) incrementCounter(counters, "fallbacks");
        const controller = new AbortController();
        let timedOut = false;
        const timeoutHandle = timer.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, requestTimeoutMs);
        try {
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
                { role: "user", content: prompt },
              ],
            }),
            signal: controller.signal,
          });
          if (timedOut) throw new OpportunityAiTimeoutError();
          if (!response.ok) {
            if (response.status !== 429) {
              const classificationBody = await readResponseBodyForClassification(response);
              if (isQuotaExhaustedError(classificationBody)) {
                throw new OpportunityAiQuotaError();
              }
            }
            throw new OpportunityAiHttpError(response.status);
          }
          try {
            const content = responseContent(await response.json());
            if (timedOut) throw new OpportunityAiTimeoutError();
            const evaluations = validateOpportunityAiBatch(
              parseOpportunityAiBatch(content),
              inputs,
            );
            incrementCounter(counters, "successes");
            return evaluations;
          } catch (error) {
            if (timedOut || error instanceof OpportunityAiTimeoutError) {
              throw new OpportunityAiTimeoutError();
            }
            throw new OpportunityAiTerminalError();
          }
        } catch (error) {
          incrementCounter(counters, "failures");
          if (timedOut) throw new OpportunityAiTimeoutError();
          throw error;
        } finally {
          timer.clearTimeout(timeoutHandle);
        }
      },
    });

    return {
      evaluations: result.value,
      provider: result.provider,
      inputHash,
      ruleOnly: false,
      providerTelemetry,
    };
  } catch {
    return opportunityAiRuleOnlyResult(providerTelemetry);
  }
}
