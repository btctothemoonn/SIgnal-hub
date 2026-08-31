"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChartNoAxesCombined,
  Clapperboard,
  LogOut,
  Radar,
  Settings,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { primaryMobileNavItems } from "@/lib/app-shell-navigation";

export type AppShellNavKey =
  | "signals"
  | "alerts"
  | "intel"
  | "holding"
  | "stocks"
  | "douyin"
  | "settings";

export type AppShellStatusPill = {
  label: string;
  children: ReactNode;
  status: string;
  tone?: string;
};

type ShellNavItemConfig = {
  key: AppShellNavKey;
  label: string;
  mobileLabel?: string;
  href: string;
  icon: typeof Activity;
};

const shellNavItems: readonly ShellNavItemConfig[] = [
  { key: "signals", label: "信号", href: "/", icon: Activity },
  { key: "alerts", label: "异动", href: "/alerts", icon: Radar },
  {
    key: "intel",
    label: "AI+币圈情报站",
    mobileLabel: "AI情报",
    href: "/intel",
    icon: Sparkles,
  },
  { key: "holding", label: "Holding", href: "/holding", icon: WalletCards },
  { key: "stocks", label: "STOCKS", href: "/stocks", icon: ChartNoAxesCombined },
  { key: "douyin", label: "抖音", href: "/douyin", icon: Clapperboard },
  { key: "settings", label: "设置", href: "/settings", icon: Settings },
] as const;

const primaryShellNavItems = shellNavItems.filter(
  (item) => item.key !== "settings",
);
const settingsShellNavItem = shellNavItems.find(
  (item) => item.key === "settings",
);
const mobileShellNavItems = primaryMobileNavItems(shellNavItems);
const NAV_PENDING_TIMEOUT_MS = 1_500;

function ShellNavItem({
  item,
  active,
  onActivate,
  onWarm,
}: {
  item: ShellNavItemConfig;
  active: boolean;
  onActivate: (key: AppShellNavKey) => void;
  onWarm?: (item: ShellNavItemConfig) => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      onClick={() => onActivate(item.key)}
      onFocus={() => {
        onActivate(item.key);
        onWarm?.(item);
      }}
      onPointerDown={() => {
        onActivate(item.key);
        onWarm?.(item);
      }}
      onPointerEnter={() => onWarm?.(item)}
      className={[
        "flex h-10 w-full items-center justify-start gap-2 rounded-lg border px-3 text-sm font-semibold transition-all duration-75 active:scale-[0.99] active:border-accent/55 active:bg-accent-soft active:text-foreground",
        active
          ? "border-accent/45 bg-accent-soft text-foreground shadow-sm"
          : "border-transparent text-muted hover:border-accent/30 hover:bg-accent-soft/70 hover:text-foreground",
      ].join(" ")}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
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
    <div className="hidden h-9 items-center gap-2 rounded-lg border border-workspace-line-strong bg-workspace-surface px-2.5 text-xs text-muted shadow-sm sm:inline-flex">
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
  subtitle = "",
  mainClassName = "mx-auto w-full max-w-[1780px] min-h-0 px-3 py-4 sm:px-5",
}: {
  activeNav: AppShellNavKey;
  children: ReactNode;
  statusPills?: AppShellStatusPill[];
  subtitle?: string;
  mainClassName?: string;
}) {
  const router = useRouter();
  const [pendingNav, setPendingNav] = useState<{
    origin: AppShellNavKey;
    target: AppShellNavKey;
  } | null>(null);
  const pendingNavTimerRef = useRef<number | null>(null);
  const displayedActiveNav =
    pendingNav?.origin === activeNav ? pendingNav.target : activeNav;

  const setPendingNavigation = (target: AppShellNavKey) => {
    if (pendingNavTimerRef.current !== null) {
      window.clearTimeout(pendingNavTimerRef.current);
    }
    setPendingNav({ origin: activeNav, target });
    pendingNavTimerRef.current = window.setTimeout(() => {
      pendingNavTimerRef.current = null;
      setPendingNav(null);
    }, NAV_PENDING_TIMEOUT_MS);
  };

  useEffect(
    () => () => {
      if (pendingNavTimerRef.current !== null) {
        window.clearTimeout(pendingNavTimerRef.current);
      }
    },
    [],
  );

  const warmRoute = (item: ShellNavItemConfig) => {
    router.prefetch(item.href);
    if (item.key === "holding") {
      void import("@/components/holding-panel");
    }
  };

  const warmSettingsRoute = () => {
    router.prefetch("/settings");
  };

  return (
    <div
      data-mobile-command-shell
      data-workspace-shell
      className="min-h-screen bg-workspace-canvas pb-[calc(4.25rem+env(safe-area-inset-bottom))] text-foreground lg:pb-0"
    >
      <div className="flex min-h-screen">
        <aside className="hidden w-[13.5rem] shrink-0 border-r border-workspace-line-strong bg-workspace-rail px-3 py-4 shadow-[8px_0_28px_-24px_rgba(15,23,42,0.28)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:items-stretch lg:overflow-y-auto lg:overscroll-contain" data-workspace-rail>
          <div className="mb-5 flex w-full items-center gap-2 rounded-lg border border-line/70 bg-workspace-surface px-2.5 py-2 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/35 bg-accent-soft font-mono text-xs font-bold text-accent">
              SH
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight text-foreground">
                Signal Hub
              </div>
              <div className="truncate text-[11px] font-medium text-muted">
                Alpha desk
              </div>
            </div>
          </div>
          <nav className="flex w-full flex-1 flex-col gap-1">
            {primaryShellNavItems.map((item) => (
              <ShellNavItem
                key={item.key}
                item={item}
                active={item.key === displayedActiveNav}
                onActivate={setPendingNavigation}
                onWarm={warmRoute}
              />
            ))}
          </nav>
          {settingsShellNavItem ? (
            <div className="w-full">
              <ShellNavItem
                item={settingsShellNavItem}
                active={displayedActiveNav === "settings"}
                onActivate={setPendingNavigation}
                onWarm={warmRoute}
              />
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 flex-1">
          <header
            data-workspace-topbar
            className="sticky top-0 z-40 border-b border-workspace-line-strong bg-workspace-toolbar/95 backdrop-blur-xl"
          >
            <div className="flex min-h-14 items-center justify-between gap-2 px-3 py-2 sm:min-h-[4.25rem] sm:px-5 lg:min-h-[4.75rem] lg:py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft font-mono text-[11px] font-bold text-accent shadow-sm lg:hidden">
                  SH
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold leading-tight text-foreground">
                    Signal Hub
                  </h1>
                  {subtitle ? (
                    <p className="mt-0.5 hidden truncate text-xs text-muted sm:block">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {statusPills.map((pill) => (
                  <StatusPill key={pill.label} {...pill} />
                ))}
                <ThemeToggle />
                <Link
                  href="/settings"
                  title="设置"
                  aria-label="设置"
                  onFocus={warmSettingsRoute}
                  onPointerDown={warmSettingsRoute}
                  onPointerEnter={warmSettingsRoute}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-workspace-line-strong bg-workspace-surface text-muted shadow-sm transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent lg:hidden"
                >
                  <Settings aria-hidden className="h-4 w-4" />
                </Link>
                <form action="/api/logout" method="post" className="contents">
                  <button
                    type="submit"
                    title="Sign out"
                    aria-label="Sign out"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-workspace-line-strong bg-workspace-surface text-muted shadow-sm transition-colors hover:border-danger/35 hover:bg-danger-soft hover:text-danger"
                  >
                    <LogOut aria-hidden className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </div>
          </header>

          <main className={mainClassName}>{children}</main>
        </div>
      </div>
      <nav
        aria-label="Mobile primary navigation"
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-workspace-line-strong bg-workspace-toolbar/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid max-w-xl grid-cols-6 gap-1">
          {mobileShellNavItems.map((item) => {
            const active = item.key === displayedActiveNav;
            const mobileLabel = item.mobileLabel ?? item.label;
            return (
              <Link
                key={item.key}
                href={item.href}
                prefetch={item.key === "intel" ? false : undefined}
                title={item.label}
                aria-label={item.label}
                onClick={(event) => {
                  setPendingNavigation(item.key);
                  if (item.key === "intel") {
                    event.preventDefault();
                    window.location.assign(item.href);
                  }
                }}
                onFocus={() => {
                  if (item.key !== "intel") warmRoute(item);
                }}
                onPointerDown={() => {
                  if (item.key !== "intel") warmRoute(item);
                }}
                onPointerEnter={() => {
                  if (item.key !== "intel") warmRoute(item);
                }}
                className={[
                  "flex h-11 flex-col items-center justify-center gap-0.5 rounded-md border text-[10px] font-semibold transition-all duration-75 active:scale-[0.98]",
                  active
                    ? "border-accent/45 bg-accent-soft text-foreground"
                    : "border-transparent text-muted hover:bg-info-soft hover:text-foreground",
                ].join(" ")}
              >
                <item.icon aria-hidden className="h-4 w-4" />
                <span>{mobileLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
