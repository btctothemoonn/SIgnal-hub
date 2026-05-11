type RefreshCoordinatorOptions = {
  minIntervalMs: number;
  now?: () => number;
};

export function createTelegramRefreshCoordinator<T>(
  options: RefreshCoordinatorOptions,
) {
  let inFlight: Promise<T> | null = null;
  let lastStartedAt = 0;
  let lastFinishedAt = 0;
  const now = options.now ?? Date.now;

  function lastRefreshAt() {
    return Math.max(lastStartedAt, lastFinishedAt);
  }

  return {
    run(fetcher: () => Promise<T>): Promise<T> {
      if (inFlight) {
        return inFlight;
      }

      lastStartedAt = now();
      try {
        inFlight = fetcher().finally(() => {
          lastFinishedAt = now();
          inFlight = null;
        });
      } catch (error) {
        inFlight = Promise.reject(error).finally(() => {
          lastFinishedAt = now();
          inFlight = null;
        });
      }

      return inFlight;
    },

    shouldStartBackgroundRefresh() {
      if (inFlight) {
        return false;
      }

      const previousRefreshAt = lastRefreshAt();
      return previousRefreshAt === 0 || now() - previousRefreshAt >= options.minIntervalMs;
    },
  };
}
