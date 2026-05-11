"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export type AppShellNavKey =
  | "signals"
  | "holding"
  | "stocks"
  | "settings";

export type AppShellStatusPill = {
  label: string;
  children: ReactNode;
  status: string;
  tone?: string;
};

const shellNavItems = [
  { key: "signals", label: "信号", href: "/", icon: "signals" },
  { key: "holding", label: "Holding", href: "/holding", icon: "wallet" },
  { key: "stocks", label: "STOCKS", href: "/stocks", icon: "spark" },
  { key: "settings", label: "设置", href: "/settings", icon: "settings" },
] as const;

const primaryShellNavItems = shellNavItems.filter(
  (item) => item.key !== "settings",
);
const settingsShellNavItem = shellNavItems.find(
  (item) => item.key === "settings",
);

type ShellIcon = (typeof shellNavItems)[number]["icon"] | "logout";

function ShellGlyph({ icon }: { icon: ShellIcon }) {
  const common = {
    className: "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (icon === "signals") {
    return (
      <svg {...common}>
        <path d="M5 19V5" />
        <path d="M5 19h14" />
        <path d="m8 15 3-3 2 2 5-6" />
        <path d="M17 8h1v1" />
      </svg>
    );
  }

  if (icon === "wallet") {
    return (
      <svg {...common}>
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19v14H6.5A2.5 2.5 0 0 1 4 16.5Z" />
        <path d="M4 8h15" />
        <path d="M15 12h4v4h-4a2 2 0 0 1 0-4Z" />
        <path d="M17 14h.01" />
      </svg>
    );
  }

  if (icon === "spark") {
    return (
      <svg {...common}>
        <path d="M12 3v4" />
        <path d="M12 17v4" />
        <path d="M3 12h4" />
        <path d="M17 12h4" />
        <path d="m6.3 6.3 2.8 2.8" />
        <path d="m14.9 14.9 2.8 2.8" />
        <path d="m17.7 6.3-2.8 2.8" />
        <path d="m9.1 14.9-2.8 2.8" />
      </svg>
    );
  }

  if (icon === "logout") {
    return (
      <svg {...common}>
        <path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" />
        <path d="M14 16l4-4-4-4" />
        <path d="M18 12H9" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function ShellNavItem({
  item,
  active,
  onActivate,
}: {
  item: (typeof shellNavItems)[number];
  active: boolean;
  onActivate: (key: AppShellNavKey) => void;
}) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      onClick={() => onActivate(item.key)}
      onFocus={() => onActivate(item.key)}
      onPointerDown={() => onActivate(item.key)}
      className={[
        "flex h-[4.25rem] w-full flex-col items-center justify-center gap-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-75 active:scale-[0.98] active:border-accent/55 active:bg-accent-soft active:text-accent",
        active
          ? "border-accent/35 bg-accent-soft text-accent"
          : "border-transparent text-muted hover:border-line/70 hover:bg-panel-strong hover:text-foreground",
      ].join(" ")}
    >
      <ShellGlyph icon={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

function StatusPill({
  label,
  children,
  status,
  tone = "text-success",
}: AppShellStatusPill) {
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-line/70 bg-panel-strong/90 px-2.5 text-xs text-muted shadow-[0_12px_28px_-24px_rgba(38,31,27,0.55)]">
      <span className="font-semibold text-foreground">{label}</span>
      <span>{children}</span>
      <span className="h-1 w-1 rounded-full bg-line" />
      <span className={tone}>{status}</span>
    </div>
  );
}

export function AppShell({
  activeNav,
  children,
  statusPills = [],
  subtitle = "Telegram / X / Truth / 消息总结 · 本地缓存面板",
  mainClassName = "mx-auto w-full max-w-[1780px] min-h-0 px-3 py-4 sm:px-5",
}: {
  activeNav: AppShellNavKey;
  children: ReactNode;
  statusPills?: AppShellStatusPill[];
  subtitle?: string;
  mainClassName?: string;
}) {
  const [optimisticActiveNav, setOptimisticActiveNav] =
    useState<AppShellNavKey>(activeNav);

  useEffect(() => {
    setOptimisticActiveNav(activeNav);
  }, [activeNav]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-[5.5rem] shrink-0 border-r border-line/70 bg-panel-strong/76 px-2 py-4 backdrop-blur-xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:items-center lg:overflow-y-auto lg:overscroll-contain">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background shadow-[0_18px_36px_-28px_rgba(38,31,27,0.8)]">
            SH
          </div>
          <nav className="flex w-full flex-1 flex-col gap-2">
            {primaryShellNavItems.map((item) => (
              <ShellNavItem
                key={item.key}
                item={item}
                active={item.key === optimisticActiveNav}
                onActivate={setOptimisticActiveNav}
              />
            ))}
          </nav>
          {settingsShellNavItem ? (
            <div className="w-full">
              <ShellNavItem
                item={settingsShellNavItem}
                active={optimisticActiveNav === "settings"}
                onActivate={setOptimisticActiveNav}
              />
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-line/70 bg-panel-strong/90 backdrop-blur-xl">
            <div className="flex min-h-[4.75rem] flex-col gap-3 px-3 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background shadow-[0_18px_36px_-28px_rgba(38,31,27,0.8)] lg:hidden">
                  SH
                </div>
                <div className="min-w-0">
                  <h1 className="font-serif text-2xl font-medium leading-tight text-foreground">
                    Signal Hub
                  </h1>
                  <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {statusPills.map((pill) => (
                  <StatusPill key={pill.label} {...pill} />
                ))}
                <ThemeToggle />
                <Link
                  href="/settings"
                  title="设置"
                  aria-label="设置"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line/70 bg-panel-strong/90 text-muted shadow-[0_12px_28px_-24px_rgba(38,31,27,0.55)] transition-colors hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
                >
                  <ShellGlyph icon="settings" />
                </Link>
                <Link
                  href="/api/logout"
                  title="Sign out"
                  aria-label="Sign out"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line/70 bg-panel-strong/90 text-muted shadow-[0_12px_28px_-24px_rgba(38,31,27,0.55)] transition-colors hover:border-danger/35 hover:bg-danger-soft hover:text-danger"
                >
                  <ShellGlyph icon="logout" />
                </Link>
              </div>
            </div>
          </header>

          <main className={mainClassName}>{children}</main>
        </div>
      </div>
    </div>
  );
}
