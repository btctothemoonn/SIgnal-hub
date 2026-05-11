export type XSnapshotMode = "pipeline" | "6551_rest";

export function getXSnapshotMode(
  env: NodeJS.ProcessEnv = process.env,
): XSnapshotMode {
  const raw = env.X_API_MODE?.trim().toLowerCase();
  if (raw === "6551_rest" || raw === "rest" || raw === "api") {
    return "6551_rest";
  }
  return "pipeline";
}

export function isXRestSnapshotMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getXSnapshotMode(env) === "6551_rest";
}
