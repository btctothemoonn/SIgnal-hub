"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ChartNoAxesCombined,
  Clapperboard,
  LogOut,
  Settings,
  WalletCards,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export type AppShellNavKey =
  | "signals"
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

const shellNavItems = [
  { key: "signals", label: "信号", href: "/", icon: Activity },
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
const NAV_PENDING_TIMEOUT_MS = 1_500;

function ShellNavItem({
  item,
  active,
  onActivate,
  onWarm,
}: {
  item: (typeof shellNavItems)[number];
  active: boolean;
  onActivate: (key: AppShellNavKey) => void;
  onWarm?: (item: (typeof shellNavItems)[number]) => void;
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
        "flex h-10 w-full items-center justify-start gap-2 rounded-lg border px-3 text-sm font-semibold transition-all duration-75 active:scale-[0.99] active:border-success/55 active:bg-success-soft active:text-foreground",
        active
          ? "border-success/45 bg-success-soft text-foreground shadow-sm"
          : "border-transparent text-muted hover:border-success/30 hover:bg-success-soft/70 hover:text-foreground",
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
    <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-workspace-line-strong bg-workspace-surface px-2.5 text-xs text-muted shadow-sm">
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

  const warmRoute = (item: (typeof shellNavItems)[number]) => {
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
      className="min-h-screen bg-workspace-canvas pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0 text-foreground"
    >
      <div className="flex min-h-screen">
        <aside className="hidden w-[13.5rem] shrink-0 border-r border-workspace-line-strong bg-workspace-rail px-3 py-4 shadow-[8px_0_28px_-24px_rgba(15,23,42,0.28)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:items-stretch lg:overflow-y-auto lg:overscroll-contain" data-workspace-rail>
          <div className="mb-5 flex w-full items-center gap-2 rounded-lg border border-line/70 bg-workspace-surface px-2.5 py-2 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-success/35 bg-success-soft font-mono text-xs font-bold text-success">
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
            <div className="flex min-h-[4.25rem] flex-col gap-2 px-3 py-2.5 sm:px-5 lg:min-h-[4.75rem] lg:flex-row lg:items-center lg:justify-between lg:py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-success/30 bg-success-soft font-mono text-xs font-bold text-success shadow-sm lg:hidden">
                  SH
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold leading-tight text-foreground">
                    Signal Hub
                  </h1>
                  {subtitle ? (
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="-mx-3 flex min-w-0 items-center gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:px-0">
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-workspace-line-strong bg-workspace-surface text-muted shadow-sm transition-colors hover:border-success/40 hover:bg-success-soft hover:text-success"
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
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-workspace-line-strong bg-workspace-toolbar/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {shellNavItems.map((item) => {
            const active = item.key === displayedActiveNav;
            return (
              <Link
                key={item.key}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                onClick={() => setPendingNavigation(item.key)}
                onFocus={() => warmRoute(item)}
                onPointerDown={() => warmRoute(item)}
                onPointerEnter={() => warmRoute(item)}
                className={[
                  "flex h-12 flex-col items-center justify-center gap-0.5 rounded-md border text-[10px] font-semibold transition-all duration-75 active:scale-[0.98]",
                  active
                    ? "border-success/45 bg-success-soft text-foreground"
                    : "border-transparent text-muted hover:bg-info-soft hover:text-foreground",
                ].join(" ")}
              >
                <item.icon aria-hidden className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
