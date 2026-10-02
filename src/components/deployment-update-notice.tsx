"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const loadedVersion = process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION;
const validVersion = /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;

export function DeploymentUpdateNotice() {
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    if (!loadedVersion) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timeout: number | undefined;
    let lastCheck = -Infinity;

    const check = async () => {
      if (disposed || document.visibilityState === "hidden" || controller || Date.now() - lastCheck < 2_000) return;
      lastCheck = Date.now();
      const pending = new AbortController();
      controller = pending;
      timeout = window.setTimeout(() => pending.abort(), 10_000);
      try {
        const response = await fetch("/api/deployment-version", {
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: pending.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!disposed && !pending.signal.aborted && typeof payload?.version === "string" && validVersion.test(payload.version)) {
          setHasUpdate(payload.version !== loadedVersion);
        }
      } catch {
        // A restart, lost connection or expired login is not proof of a new version.
      } finally {
        window.clearTimeout(timeout);
        controller = null;
      }
    };
    const resume = () => { void check(); };
    const interval = window.setInterval(resume, 60_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    resume();

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, []);

  if (!hasUpdate) return null;

  return (
    <div role="status" aria-live="polite" className="flex items-center justify-between gap-3 border-t border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning sm:px-5">
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
        有更新，请刷新
      </span>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-warning/35 px-2.5 py-1 font-semibold transition-colors hover:bg-warning/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning">
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        立即刷新
      </button>
    </div>
  );
}
