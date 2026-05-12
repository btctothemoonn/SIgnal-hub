import {
  ALPHA_SUMMARY_AUDIENCES,
  ALPHA_SUMMARY_SCOPES,
  getOrCreateAlphaSummary,
  normalizeAlphaSummaryAudience,
  normalizeAlphaSummaryScope,
  type AlphaSummaryAudience,
  type AlphaSummaryScope,
  type AlphaSummarySnapshot,
} from "./alpha-summary.ts";

type EnvLike = Record<string, string | undefined>;

export type AlphaSummaryPrewarmResult = {
  audience: AlphaSummaryAudience;
  scope: AlphaSummaryScope;
  success: boolean;
  status: AlphaSummarySnapshot["status"] | "skipped";
  generatedAt: string | null;
  itemCount: number;
  error: string | null;
};

type GenerateSummary = (request: {
  force: false;
  now: Date;
  env: EnvLike;
  scope: AlphaSummaryScope;
  audience: AlphaSummaryAudience;
}) => Promise<AlphaSummarySnapshot>;

const DEFAULT_PREWARM_INTERVAL_MS = 30 * 60 * 1000;
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseList(raw: string | undefined) {
  return (raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isAlphaSummaryPrewarmEnabled(env: EnvLike = process.env) {
  const raw = env.AI_SUMMARY_PREWARM_ENABLED?.trim().toLowerCase();
  return !raw || !FALSE_VALUES.has(raw);
}

export function getAlphaSummaryPrewarmIntervalMs(
  env: EnvLike = process.env,
) {
  return positiveInt(
    env.AI_SUMMARY_PREWARM_INTERVAL_MS,
    DEFAULT_PREWARM_INTERVAL_MS,
  );
}

export function getAlphaSummaryPrewarmScopes(
  env: EnvLike = process.env,
): AlphaSummaryScope[] {
  const configured = parseList(env.AI_SUMMARY_PREWARM_SCOPES)
    .map(normalizeAlphaSummaryScope)
    .filter((scope, index, scopes) => scopes.indexOf(scope) === index);
  return configured.length > 0 ? configured : [...ALPHA_SUMMARY_SCOPES];
}

export function getAlphaSummaryPrewarmAudiences(
  env: EnvLike = process.env,
): AlphaSummaryAudience[] {
  const configured = parseList(env.AI_SUMMARY_PREWARM_AUDIENCES)
    .map(normalizeAlphaSummaryAudience)
    .filter((audience, index, audiences) => audiences.indexOf(audience) === index);
  return configured.length > 0 ? configured : [ALPHA_SUMMARY_AUDIENCES[0]];
}

export async function prewarmAlphaSummaryCaches({
  env = process.env,
  now = new Date(),
  scopes = getAlphaSummaryPrewarmScopes(env),
  audiences = getAlphaSummaryPrewarmAudiences(env),
  generateSummary = getOrCreateAlphaSummary as GenerateSummary,
}: {
  env?: EnvLike;
  now?: Date;
  scopes?: AlphaSummaryScope[];
  audiences?: AlphaSummaryAudience[];
  generateSummary?: GenerateSummary;
} = {}): Promise<AlphaSummaryPrewarmResult[]> {
  if (!isAlphaSummaryPrewarmEnabled(env)) {
    return audiences.flatMap((audience) =>
      scopes.map((scope) => ({
        audience,
        scope,
        success: true,
        status: "skipped" as const,
        generatedAt: null,
        itemCount: 0,
        error: null,
      })),
    );
  }

  const results: AlphaSummaryPrewarmResult[] = [];
  for (const audience of audiences) {
    for (const scope of scopes) {
      try {
        const snapshot = await generateSummary({
          force: false,
          now,
          env,
          scope,
          audience,
        });
        results.push({
          audience,
          scope,
          success: snapshot.success,
          status: snapshot.status,
          generatedAt: snapshot.generatedAt,
          itemCount: snapshot.itemCount,
          error: snapshot.error,
        });
      } catch (error) {
        results.push({
          audience,
          scope,
          success: false,
          status: "error",
          generatedAt: null,
          itemCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}
