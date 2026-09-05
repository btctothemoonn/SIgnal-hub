import { getMonitor985AccountSyncIntervalMs } from "./monitor985-sync-policy.ts";

export function createMonitor985WatchConfigCache<T>({
  load, onError, now = Date.now, env = process.env,
}: {
  load: () => Promise<T>;
  onError: (error: unknown) => void;
  now?: () => number;
  env?: Record<string, string | undefined>;
}) {
  let value: T | null = null;
  let refreshAt = 0;
  let pending: Promise<T | null> | null = null;
  return {
    async get(): Promise<T | null> {
      if (pending) return pending;
      if (now() < refreshAt) return value;
      pending = (async () => {
        try {
          value = await load();
          refreshAt = now() + getMonitor985AccountSyncIntervalMs(env);
        } catch (error) {
          refreshAt = now() + Math.min(5 * 60_000, getMonitor985AccountSyncIntervalMs(env));
          onError(error);
        }
        return value;
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
