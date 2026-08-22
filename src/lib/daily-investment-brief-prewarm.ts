import {
  getOrCreateDailyInvestmentBrief,
  isDailyBriefDue,
  type DailyBriefSnapshot,
} from "./daily-investment-brief.ts";

type EnvLike = Record<string, string | undefined>;

type GenerateBrief = (request: {
  force: false;
  now: Date;
  env: EnvLike;
}) => Promise<DailyBriefSnapshot>;

export type DailyBriefPrewarmResult = {
  success: boolean;
  status: DailyBriefSnapshot["status"] | "skipped";
  generatedAt: string | null;
  candidateCount: number;
  error: string | null;
};

const DEFAULT_WORKER_INTERVAL_MS = 15 * 60 * 1000;
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function positiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isDailyBriefPrewarmEnabled(env: EnvLike = process.env) {
  const raw = env.DAILY_BRIEF_ENABLED?.trim().toLowerCase();
  return !raw || !FALSE_VALUES.has(raw);
}

export function getDailyBriefWorkerIntervalMs(env: EnvLike = process.env) {
  return positiveInt(env.DAILY_BRIEF_WORKER_INTERVAL_MS, DEFAULT_WORKER_INTERVAL_MS);
}

export async function prewarmDailyInvestmentBrief({
  env = process.env,
  now = new Date(),
  generateBrief = getOrCreateDailyInvestmentBrief as GenerateBrief,
}: {
  env?: EnvLike;
  now?: Date;
  generateBrief?: GenerateBrief;
} = {}): Promise<DailyBriefPrewarmResult> {
  if (!isDailyBriefPrewarmEnabled(env) || !isDailyBriefDue({ now, env })) {
    return {
      success: true,
      status: "skipped",
      generatedAt: null,
      candidateCount: 0,
      error: null,
    };
  }

  try {
    const snapshot = await generateBrief({ force: false, now, env });
    return {
      success: snapshot.success,
      status: snapshot.status,
      generatedAt: snapshot.generatedAt,
      candidateCount: snapshot.candidateCount,
      error: snapshot.error,
    };
  } catch (error) {
    return {
      success: false,
      status: "error",
      generatedAt: null,
      candidateCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
