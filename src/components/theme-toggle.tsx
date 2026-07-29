"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

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
  const Icon: LucideIcon =
    theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <button
      onClick={cycle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-workspace-line-strong bg-workspace-surface-raised text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
      aria-label={`切换主题，当前：${label}`}
      title={label}
    >
      <Icon aria-hidden className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}
