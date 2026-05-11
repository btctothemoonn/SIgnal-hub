import { buildMonitor985RequestHeaders, buildMonitor985RequestUrl } from "./monitor985-auth";
import {
  extractMonitor985Events,
  normalizeMonitor985Event,
} from "./monitor985";
import { parseMonitor985WatchConfig, toMonitor985XPipelineAccounts } from "./monitor985-watch-config";
import {
  disableXPipelineAccountsExcept,
  setXPipelineHealth,
  upsertXPipelineAccount,
  upsertXPipelineRealtimeUpdate,
} from "./x-pipeline-store";
import { getXPipelineConfiguredTruthAccounts } from "./x-pipeline-accounts";
import {
  buildMonitor985CatchupSummary,
  getMonitor985CatchupLimit,
  type Monitor985CatchupInput,
} from "./monitor985-catchup-policy";

type EnvLike = Record<string, string | undefined>;

export {
  buildMonitor985CatchupSummary,
  getMonitor985CatchupLimit,
  type Monitor985CatchupInput,
} from "./monitor985-catchup-policy";

export type Monitor985CatchupResult = {
  fetched: number;
  accepted: number;
  ignored: number;
  accountSource: "985" | "local";
  detail: string;
};

function accountKey(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

async function fetchJson(path: string, env: EnvLike) {
  const response = await fetch(
    buildMonitor985RequestUrl(path, env.MONITOR985_BASE_URL || "https://985monitor.xyz", env),
    {
      cache: "no-store",
      headers: buildMonitor985RequestHeaders(env),
    },
  );
  if (!response.ok) {
    throw new Error(`985monitor HTTP ${response.status}`);
  }
  return response.json();
}

export async function runMonitor985ManualCatchup({
  env = process.env,
  input = {},
}: {
  env?: EnvLike;
  input?: Monitor985CatchupInput;
} = {}): Promise<Monitor985CatchupResult> {
  const limit = getMonitor985CatchupLimit(input, env);
  const watchConfig = await fetchJson("/api/watch-config", env);
  const remoteAccounts = toMonitor985XPipelineAccounts(
    parseMonitor985WatchConfig(watchConfig),
  );
  const truthAccounts = getXPipelineConfiguredTruthAccounts(env as NodeJS.ProcessEnv);
  const accounts =
    remoteAccounts.length > 0 ? [...remoteAccounts, ...truthAccounts] : truthAccounts;
  const accountSource: Monitor985CatchupResult["accountSource"] =
    remoteAccounts.length > 0 ? "985" : "local";
  const allowed = new Set(accounts.map((account) => accountKey(account.username)));

  for (const account of accounts) {
    upsertXPipelineAccount(account);
  }
  disableXPipelineAccountsExcept(accounts.map((account) => account.username));

  const payloads = await Promise.all([
    fetchJson(`/api/twitter-live-events?limit=${limit}`, env),
    fetchJson(`/api/truth-social-events?limit=${limit}`, env),
  ]);
  const events = payloads.flatMap((payload) => extractMonitor985Events(payload));
  let accepted = 0;
  let ignored = 0;

  for (const rawEvent of events.slice().reverse()) {
    const update = normalizeMonitor985Event(rawEvent);
    if (!update || !allowed.has(accountKey(update.account))) {
      ignored += 1;
      continue;
    }
    upsertXPipelineRealtimeUpdate({
      ...update,
      remark: "985monitor",
      feedItem: {
        ...update.feedItem,
        queryLabel: update.feedItem.queryLabel || "985monitor",
      },
    });
    accepted += 1;
  }

  const detail = buildMonitor985CatchupSummary({
    fetched: events.length,
    accepted,
    ignored,
    accountSource,
  });
  setXPipelineHealth({
    scope: "manual-catchup",
    status: "live",
    detail,
  });
  setXPipelineHealth({
    scope: "collector",
    status: "live",
    detail,
  });
  return {
    fetched: events.length,
    accepted,
    ignored,
    accountSource,
    detail,
  };
}
