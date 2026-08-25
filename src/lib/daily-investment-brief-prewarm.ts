import {
  getLatestDailyInvestmentBrief,
  getNextDailyBriefScheduleAt,
  getOrCreateDailyInvestmentBrief,
  isDailyBriefDue,
  type DailyBriefSnapshot,
} from "./daily-investment-brief.ts";

type EnvLike = Record<string, string | undefined>;

type GenerateBrief = (request: {
  force: true;
  now: Date;
  env: EnvLike;
}) => Promise<DailyBriefSnapshot>;

type GetLatestBrief = (request: {
  now: Date;
  env: EnvLike;
}) => Promise<DailyBriefSnapshot>;

export type DailyBriefPrewarmResult = {
  success: boolean;
  status: DailyBriefSnapshot["status"] | "skipped";
  generatedAt: string | null;
  candidateCount: number;
  error: string | null;
  shouldRetry: boolean;
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

export function getDailyBriefNextRunDelayMs({
  now = new Date(),
  env = process.env,
}: {
  now?: Date;
  env?: EnvLike;
} = {}) {
  return Math.max(
    1_000,
    Date.parse(getNextDailyBriefScheduleAt({ now, env })) - now.getTime(),
  );
}

export function getDailyBriefWorkerDelayMs({
  now = new Date(),
  env = process.env,
  shouldRetry = false,
}: {
  now?: Date;
  env?: EnvLike;
  shouldRetry?: boolean;
} = {}) {
  const scheduleDelayMs = getDailyBriefNextRunDelayMs({ now, env });
  return shouldRetry
    ? Math.min(getDailyBriefWorkerIntervalMs(env), scheduleDelayMs)
    : scheduleDelayMs;
}

export async function prewarmDailyInvestmentBrief({
  env = process.env,
  now = new Date(),
  getLatestBrief = getLatestDailyInvestmentBrief as GetLatestBrief,
  generateBrief = getOrCreateDailyInvestmentBrief as GenerateBrief,
}: {
  env?: EnvLike;
  now?: Date;
  getLatestBrief?: GetLatestBrief;
  generateBrief?: GenerateBrief;
} = {}): Promise<DailyBriefPrewarmResult> {
  if (!isDailyBriefPrewarmEnabled(env)) {
    return {
      success: true,
      status: "skipped",
      generatedAt: null,
      candidateCount: 0,
      error: null,
      shouldRetry: false,
    };
  }

  try {
    const latest = await getLatestBrief({ now, env });
    const generatedAt = latest.success ? latest.generatedAt : null;
    if (!isDailyBriefDue({ now, env, generatedAt })) {
      return {
        success: true,
        status: "skipped",
        generatedAt,
        candidateCount: latest.candidateCount,
        error: null,
        shouldRetry: false,
      };
    }

    const snapshot = await generateBrief({ force: true, now, env });
    const fulfilled =
      snapshot.success &&
      !isDailyBriefDue({ now, env, generatedAt: snapshot.generatedAt });
    return {
      success: snapshot.success,
      status: snapshot.status,
      generatedAt: snapshot.generatedAt,
      candidateCount: snapshot.candidateCount,
      error: snapshot.error,
      shouldRetry: !fulfilled,
    };
  } catch (error) {
    return {
      success: false,
      status: "error",
      generatedAt: null,
      candidateCount: 0,
      error: error instanceof Error ? error.message : String(error),
      shouldRetry: true,
    };
  }
}
