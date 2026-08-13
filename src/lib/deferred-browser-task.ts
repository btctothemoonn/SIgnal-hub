type IdleCallback = (deadline?: unknown) => void;

type DeferredTaskHost = {
  requestIdleCallback?: (
    callback: IdleCallback,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout: (callback: () => void, timeoutMs: number) => number;
  clearTimeout: (id: number) => void;
};

type DeferredTaskOptions = {
  host?: DeferredTaskHost;
  timeoutMs?: number;
};

export function scheduleDeferredBrowserTask(
  task: () => void,
  options: DeferredTaskOptions = {},
) {
  const host = options.host ?? (window as unknown as DeferredTaskHost);
  const timeoutMs = options.timeoutMs ?? 350;

  if (host.requestIdleCallback) {
    const id = host.requestIdleCallback(task, { timeout: timeoutMs });
    return () => host.cancelIdleCallback?.(id);
  }

  const id = host.setTimeout(task, timeoutMs);
  return () => host.clearTimeout(id);
}
