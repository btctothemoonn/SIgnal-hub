import { tmpdir } from "node:os";
import { join } from "node:path";

type EnvLike = Record<string, string | undefined>;

function isVercelRuntime(env: EnvLike) {
  return Boolean(env.VERCEL?.trim() || env.VERCEL_ENV?.trim());
}

export function getRuntimeStorageRoot(env: EnvLike = process.env) {
  const configured = env.SIGNAL_HUB_RUNTIME_DIR?.trim();
  if (configured) return configured;

  return isVercelRuntime(env)
    ? join(tmpdir(), "signal-hub")
    : join(process.cwd(), ".signal-hub");
}

export function getRuntimeDataPath(
  env: EnvLike = process.env,
  ...segments: string[]
) {
  return join(getRuntimeStorageRoot(env), ...segments);
}
