"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

type Theme = "light" | "dark" | "system";
const THEME_STORAGE_KEY = "signal-hub:theme:cromojo-dark-dashboard:v1";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "dark";
}

function getResolvedTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
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
  return "dark";
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
      theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    window.dispatchEvent(new Event("themechange"));
  }, [theme]);

  const label =
    theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统";
  const Icon: LucideIcon =
    theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <button
      onClick={cycle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-workspace-line-strong bg-workspace-surface text-muted shadow-sm transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
      aria-label={`切换主题，当前：${label}`}
      title={label}
    >
      <Icon aria-hidden className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}
