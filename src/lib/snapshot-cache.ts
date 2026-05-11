export type SnapshotCache<T> = {
  get: () => Promise<T>;
  invalidate: () => void;
};

export function createSnapshotCache<T>(
  fetcher: () => Promise<T>,
  ttlMs: number,
): SnapshotCache<T> {
  let value: T | null = null;
  let fetchedAt = 0;
  let pending: Promise<T> | null = null;

  const refresh = () => {
    const run = fetcher().then(
      (next) => {
        value = next;
        fetchedAt = Date.now();
        pending = null;
        return next;
      },
      (err) => {
        pending = null;
        throw err;
      },
    );
    pending = run;
    return run;
  };

  return {
    async get() {
      if (pending) return pending;
      if (value !== null && Date.now() - fetchedAt < ttlMs) {
        return value;
      }
      return refresh();
    },
    invalidate() {
      value = null;
      fetchedAt = 0;
    },
  };
}
