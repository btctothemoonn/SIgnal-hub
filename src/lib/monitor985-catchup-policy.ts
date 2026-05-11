type EnvLike = Record<string, string | undefined>;

export type Monitor985CatchupInput = {
  limit?: number;
};

function positiveInt(raw: unknown, fallback: number): number {
  const parsed =
    typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMonitor985CatchupLimit(
  input: Monitor985CatchupInput = {},
  env: EnvLike = process.env,
): number {
  return positiveInt(
    input.limit,
    positiveInt(env.MONITOR985_MANUAL_CATCHUP_LIMIT, 30),
  );
}

export function buildMonitor985CatchupSummary(input: {
  fetched: number;
  accepted: number;
  ignored: number;
  accountSource: string;
}) {
  return `985 最新流已刷新：写入 ${input.accepted} 条，忽略 ${input.ignored} 条，来源 ${input.accountSource}，拉取 ${input.fetched} 条。`;
}
