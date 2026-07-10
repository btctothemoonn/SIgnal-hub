"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  parseBrowserJson,
  readBrowserStorage,
  subscribeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser-storage-store";

export function useBrowserJsonCache<T>(
  key: string,
): readonly [T | null, (value: T) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeBrowserStorage(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => readBrowserStorage(key), [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const value = useMemo(() => parseBrowserJson<T>(raw), [raw]);
  const writeValue = useCallback(
    (nextValue: T) => {
      try {
        const serialized = JSON.stringify(nextValue);
        if (serialized !== undefined) writeBrowserStorage(key, serialized);
      } catch {
        // Invalid JSON values leave the last readable snapshot intact.
      }
    },
    [key],
  );

  return useMemo(() => [value, writeValue] as const, [value, writeValue]);
}
