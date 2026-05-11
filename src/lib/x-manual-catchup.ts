type EnvLike = Record<string, string | undefined>;

export const X_MANUAL_CATCHUP_HEALTH_SCOPE = "manual-catchup";

export type XManualCatchupInput = {
  lookbackHours?: number;
  batchLimit?: number;
  rowDelayMs?: number;
};

export type XManualCatchupRuntimeOptions = {
  lookbackMs: number;
  batchLimit: number;
  scanLimit: number;
  rowDelayMs: number;
  healthScope: string;
};

export type XManualCatchupSpawnConfig = {
  cwd: string;
  nodePath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  options: XManualCatchupRuntimeOptions;
};

function positiveInt(raw: unknown, fallback: number): number {
  const parsed =
    typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveXManualCatchupRuntimeOptions({
  env = process.env,
  input = {},
}: {
  env?: EnvLike;
  input?: XManualCatchupInput;
} = {}): XManualCatchupRuntimeOptions {
  const lookbackHours = positiveInt(
    input.lookbackHours,
    positiveInt(env.X_MANUAL_CATCHUP_LOOKBACK_HOURS, 36),
  );
  const batchLimit = positiveInt(
    input.batchLimit,
    positiveInt(env.X_MANUAL_CATCHUP_BATCH_LIMIT, 120),
  );
  const scanLimit = positiveInt(
    env.X_MANUAL_CATCHUP_SCAN_LIMIT,
    Math.max(1000, batchLimit * 50),
  );
  const rowDelayMs = positiveInt(
    input.rowDelayMs,
    positiveInt(env.X_MANUAL_CATCHUP_ROW_DELAY_MS, 5000),
  );

  return {
    lookbackMs: lookbackHours * 60 * 60 * 1000,
    batchLimit,
    scanLimit,
    rowDelayMs,
    healthScope: X_MANUAL_CATCHUP_HEALTH_SCOPE,
  };
}

export function buildXManualCatchupSpawnConfig({
  cwd,
  nodePath,
  env = process.env,
  input,
}: {
  cwd: string;
  nodePath: string;
  env?: EnvLike;
  input?: XManualCatchupInput;
}): XManualCatchupSpawnConfig {
  const options = resolveXManualCatchupRuntimeOptions({ env, input });

  return {
    cwd,
    nodePath,
    args: [
      "--experimental-strip-types",
      "--experimental-transform-types",
      "scripts/x-hybrid-worker.mjs",
      "--once",
    ],
    env: {
      ...process.env,
      ...env,
      X_HYBRID_CATCHUP_LOOKBACK_MS: String(options.lookbackMs),
      X_HYBRID_BATCH_LIMIT: String(options.batchLimit),
      X_HYBRID_SCAN_LIMIT: String(options.scanLimit),
      X_HYBRID_ROW_DELAY_MS: String(options.rowDelayMs),
      X_HYBRID_RETRY_ERRORS: "true",
      X_HYBRID_HEALTH_SCOPE: options.healthScope,
    },
    options,
  };
}
