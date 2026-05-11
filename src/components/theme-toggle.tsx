"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

function getResolvedTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const resolved = getResolvedTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

function subscribeTheme(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("themechange", listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("themechange", listener);
  };
}

function getServerThemeSnapshot(): Theme {
  return "system";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getStoredTheme,
    getServerThemeSnapshot,
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const cycle = useCallback(() => {
    const next: Theme =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    localStorage.setItem("theme", next);
    applyTheme(next);
    window.dispatchEvent(new Event("themechange"));
  }, [theme]);

  const label =
    theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统";

  return (
    <button
      onClick={cycle}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-line/70 bg-panel-strong/90 px-3 text-xs font-semibold text-muted shadow-[0_12px_28px_-24px_rgba(38,31,27,0.55)] transition-colors hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
      aria-label={`切换主题，当前：${label}`}
      title={label}
    >
      <span className="font-mono text-[11px]">
        {theme === "light" ? "L" : theme === "dark" ? "D" : "S"}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
