const BROWSER_STORAGE_EVENT = "signal-hub:storage-change";
const browserStorageFallbacks = new Map<string, string>();

export function parseBrowserJson<T>(raw: string | null): T | null {
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readBrowserStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  if (browserStorageFallbacks.has(key)) {
    return browserStorageFallbacks.get(key) ?? null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeBrowserStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
    browserStorageFallbacks.delete(key);
  } catch {
    browserStorageFallbacks.set(key, value);
    // Storage may be unavailable in private browsing or after quota exhaustion.
  }

  window.dispatchEvent(new CustomEvent(BROWSER_STORAGE_EVENT, { detail: key }));
}

export function removeBrowserStorage(key: string): void {
  if (typeof window === "undefined") return;

  browserStorageFallbacks.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private browsing.
  }

  window.dispatchEvent(new CustomEvent(BROWSER_STORAGE_EVENT, { detail: key }));
}

export function subscribeBrowserStorage(
  key: string,
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === null) {
      browserStorageFallbacks.clear();
      listener();
      return;
    }
    if (event.key === key) {
      browserStorageFallbacks.delete(key);
      listener();
    }
  };
  const onSameTabStorage = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail === key) listener();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(BROWSER_STORAGE_EVENT, onSameTabStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BROWSER_STORAGE_EVENT, onSameTabStorage);
  };
}
