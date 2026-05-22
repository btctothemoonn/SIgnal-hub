import type { XPipelineAccountInput } from "./x-pipeline-store.ts";

export function monitor985AccountKey(value: string | null | undefined): string {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function isMonitor985UnconfiguredAccountAllowed(
  env: NodeJS.ProcessEnv = process.env,
) {
  const filterMode = env.MONITOR985_FILTER_MODE?.trim().toLowerCase();
  const explicitAllow =
    env.MONITOR985_ALLOW_UNCONFIGURED_ACCOUNTS?.trim().toLowerCase() || "";
  return (
    filterMode === "all" &&
    Boolean(explicitAllow) &&
    ["1", "true", "yes", "on"].includes(explicitAllow)
  );
}

export function shouldAcceptMonitor985Account(
  account: string,
  allowedAccountKeys: Set<string>,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (isMonitor985UnconfiguredAccountAllowed(env)) return true;
  return allowedAccountKeys.has(monitor985AccountKey(account));
}

export function resolveMonitor985AcceptedAccounts({
  localAccounts,
  truthAccounts,
  remoteAccounts = [],
}: {
  localAccounts: XPipelineAccountInput[];
  truthAccounts: XPipelineAccountInput[];
  remoteAccounts?: XPipelineAccountInput[];
}) {
  const accounts = [...localAccounts, ...truthAccounts];
  const allowedAccountKeys = new Set(
    accounts.map((account) => monitor985AccountKey(account.username)),
  );
  const ignoredRemoteAccounts = remoteAccounts.filter((account) => {
    const key = monitor985AccountKey(account.username);
    return key && !allowedAccountKeys.has(key);
  });

  return {
    accounts,
    allowedAccountKeys,
    ignoredRemoteAccounts,
  };
}
