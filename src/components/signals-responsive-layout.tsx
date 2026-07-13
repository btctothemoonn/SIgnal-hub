"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlphaSummaryCard } from "@/components/alpha-summary-card";
import { OpportunityRadar } from "@/components/opportunity-radar";
import { UnifiedNewsPanel } from "@/components/unified-news-panel";
import type { TwitterDashboardSnapshot } from "@/lib/6551-twitter";
import type { TelegramDashboardSnapshot } from "@/lib/telegram-channels";

type SignalMobilePanel = "feed" | "opportunities" | "summary";
type SignalDesktopPanel = "feed" | "opportunities";

type SignalsResponsiveLayoutProps = {
  initialTelegramSnapshot: TelegramDashboardSnapshot;
  initialXSnapshot: TwitterDashboardSnapshot;
  pollXSnapshot: boolean;
  opportunityEnabled: boolean;
};

const mobilePanels: Array<{ id: SignalMobilePanel; label: string }> = [
  { id: "feed", label: "最新推送" },
  { id: "summary", label: "AI 总结" },
];

const enabledMobilePanels: Array<{ id: SignalMobilePanel; label: string }> = [
  { id: "feed", label: "最新推送" },
  { id: "opportunities", label: "机会" },
  { id: "summary", label: "AI 总结" },
];

const MOBILE_PANEL_INDEX = {
  feed: 0,
  opportunities: 1,
  summary: 2,
} as const;

const MOBILE_TAB_ID: Record<SignalMobilePanel, string> = {
  feed: "signal-mobile-tab-feed",
  opportunities: "signal-mobile-tab-opportunities",
  summary: "signal-mobile-tab-summary",
};

const MOBILE_PANEL_ID: Record<SignalMobilePanel, string> = {
  feed: "signal-mobile-panel-feed",
  opportunities: "signal-mobile-panel-opportunities",
  summary: "signal-mobile-panel-summary",
};

export function SignalsResponsiveLayout({
  initialTelegramSnapshot,
  initialXSnapshot,
  pollXSnapshot,
  opportunityEnabled,
}: SignalsResponsiveLayoutProps) {
  const mobileScrollerRef = useRef<HTMLDivElement | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [activeMobilePanel, setActiveMobilePanel] =
    useState<SignalMobilePanel>("feed");
  const [activeDesktopPanel, setActiveDesktopPanel] =
    useState<SignalDesktopPanel>("feed");

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncLayout = () => setIsDesktop(media.matches);

    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

  const showMobilePanel = useCallback(
    (panel: SignalMobilePanel) => {
      setActiveMobilePanel(panel);
      const scroller = mobileScrollerRef.current;
      if (!scroller) return;

      const index = opportunityEnabled
        ? MOBILE_PANEL_INDEX[panel]
        : panel === "feed"
          ? 0
          : 1;
      scroller.scrollTo({
        left: scroller.clientWidth * index,
        behavior: opportunityEnabled ? "auto" : "smooth",
      });
    },
    [opportunityEnabled],
  );

  const handleMobileTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, panel: SignalMobilePanel) => {
      const currentIndex = MOBILE_PANEL_INDEX[panel];
      let nextIndex: number;

      if (event.key === "ArrowLeft") {
        nextIndex =
          (currentIndex + enabledMobilePanels.length - 1) %
          enabledMobilePanels.length;
      } else if (event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % enabledMobilePanels.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = enabledMobilePanels.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      const nextPanel = enabledMobilePanels[nextIndex].id;
      showMobilePanel(nextPanel);
      document.getElementById(MOBILE_TAB_ID[nextPanel])?.focus();
    },
    [showMobilePanel],
  );

  const handleMobileScroll = useCallback(() => {
    const scroller = mobileScrollerRef.current;
    if (!scroller) return;

    let nextPanel: SignalMobilePanel;
    if (!opportunityEnabled) {
      nextPanel =
        scroller.scrollLeft >= scroller.clientWidth * 0.5
          ? "summary"
          : "feed";
    } else {
      const index = Math.min(
        MOBILE_PANEL_INDEX.summary,
        Math.max(0, Math.round(scroller.scrollLeft / scroller.clientWidth)),
      );
      nextPanel =
        index === MOBILE_PANEL_INDEX.opportunities
          ? "opportunities"
          : index === MOBILE_PANEL_INDEX.summary
            ? "summary"
            : "feed";
    }
    setActiveMobilePanel((current) =>
      current === nextPanel ? current : nextPanel,
    );
  }, [opportunityEnabled]);

  if (isDesktop === null) {
    return (
      <div className="min-h-[24rem] rounded-lg border border-line/70 bg-panel/70" />
    );
  }

  if (isDesktop && !opportunityEnabled) {
    return (
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1.42fr)_minmax(26rem,0.95fr)] lg:items-start lg:gap-4 xl:grid-cols-[minmax(0,1.52fr)_minmax(30rem,0.88fr)]">
        <section id="signals" className="min-w-0">
          <UnifiedNewsPanel
            initialTelegramSnapshot={initialTelegramSnapshot}
            initialXSnapshot={initialXSnapshot}
            pollXSnapshot={pollXSnapshot}
            rail
          />
        </section>

        <aside
          id="alpha"
          className="relative z-10 min-w-0 lg:sticky lg:top-[5.25rem]"
        >
          <AlphaSummaryCard
            audience="signals"
            compact
            className="mobile-command-summary lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain"
            deskLabel="Signals AI"
            endpoint="/api/signal-summary"
            showHeaderMeta={false}
          />
        </aside>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1.42fr)_minmax(26rem,0.95fr)] lg:items-start lg:gap-4 xl:grid-cols-[minmax(0,1.52fr)_minmax(30rem,0.88fr)]">
        <div className="min-w-0">
          <div className="mb-3 rounded-lg border border-line/70 bg-panel-strong/95 p-1">
            <div className="grid grid-cols-2 gap-1">
              {([
                { id: "feed", label: "推送" },
                { id: "opportunities", label: "机会" },
              ] as const).map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  aria-pressed={activeDesktopPanel === panel.id}
                  onClick={() => setActiveDesktopPanel(panel.id)}
                  className={[
                    "h-9 rounded-md text-sm font-semibold transition-colors",
                    activeDesktopPanel === panel.id
                      ? "bg-foreground text-background"
                      : "text-muted hover:bg-panel hover:text-foreground",
                  ].join(" ")}
                >
                  {panel.label}
                </button>
              ))}
            </div>
          </div>

          <section
            id="signals"
            className={activeDesktopPanel === "feed" ? "min-w-0" : "hidden"}
          >
            <UnifiedNewsPanel
              initialTelegramSnapshot={initialTelegramSnapshot}
              initialXSnapshot={initialXSnapshot}
              pollXSnapshot={pollXSnapshot}
              rail
            />
          </section>
          <section
            id="opportunities"
            className={
              activeDesktopPanel === "opportunities" ? "min-w-0" : "hidden"
            }
          >
            <OpportunityRadar />
          </section>
        </div>

        <aside
          id="alpha"
          className="relative z-10 min-w-0 lg:sticky lg:top-[5.25rem]"
        >
          <AlphaSummaryCard
            audience="signals"
            compact
            className="mobile-command-summary lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain"
            deskLabel="Signals AI"
            endpoint="/api/signal-summary"
            showHeaderMeta={false}
          />
        </aside>
      </div>
    );
  }

  if (!opportunityEnabled) {
    return (
      <section data-mobile-signal-pager className="min-w-0">
        <div className="mb-3 rounded-lg border border-line/70 bg-panel-strong/95 p-1 shadow-[0_18px_36px_-32px_rgba(0,0,0,0.7)]">
          <div className="grid grid-cols-2 gap-1">
            {mobilePanels.map((panel) => (
              <button
                key={panel.id}
                type="button"
                aria-pressed={activeMobilePanel === panel.id}
                onClick={() => showMobilePanel(panel.id)}
                className={[
                  "h-9 rounded-md text-sm font-semibold transition-colors",
                  activeMobilePanel === panel.id
                    ? "bg-foreground text-background shadow-[0_14px_30px_-25px_rgba(38,31,27,0.8)]"
                    : "text-muted hover:bg-panel hover:text-foreground",
                ].join(" ")}
              >
                {panel.label}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={mobileScrollerRef}
          onScroll={handleMobileScroll}
          className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="w-full shrink-0 snap-start">
            <UnifiedNewsPanel
              initialTelegramSnapshot={initialTelegramSnapshot}
              initialXSnapshot={initialXSnapshot}
              pollXSnapshot={pollXSnapshot}
            />
          </div>
          <div className="w-full shrink-0 snap-start pl-3">
            <AlphaSummaryCard
              audience="signals"
              compact
              className="mobile-command-summary"
              deskLabel="Signals AI"
              endpoint="/api/signal-summary"
              showHeaderMeta={false}
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-mobile-signal-pager className="min-w-0">
      <div className="mb-3 rounded-lg border border-line/70 bg-panel-strong/95 p-1 shadow-[0_18px_36px_-32px_rgba(0,0,0,0.7)]">
        <div
          role="tablist"
          aria-label="Signal Flow 移动视图"
          className="grid grid-cols-3 gap-1"
        >
          {(opportunityEnabled ? enabledMobilePanels : mobilePanels).map((panel) => (
            <button
              key={panel.id}
              id={MOBILE_TAB_ID[panel.id]}
              type="button"
              role="tab"
              aria-selected={activeMobilePanel === panel.id}
              aria-controls={MOBILE_PANEL_ID[panel.id]}
              tabIndex={activeMobilePanel === panel.id ? 0 : -1}
              onClick={() => showMobilePanel(panel.id)}
              onKeyDown={(event) => handleMobileTabKeyDown(event, panel.id)}
              className={[
                "h-9 rounded-md text-sm font-semibold transition-colors",
                activeMobilePanel === panel.id
                  ? "bg-foreground text-background shadow-[0_14px_30px_-25px_rgba(38,31,27,0.8)]"
                  : "text-muted hover:bg-panel hover:text-foreground",
              ].join(" ")}
            >
              {panel.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={mobileScrollerRef}
        onScroll={handleMobileScroll}
        className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          id={MOBILE_PANEL_ID.feed}
          role="tabpanel"
          aria-labelledby={MOBILE_TAB_ID.feed}
          aria-hidden={activeMobilePanel !== "feed"}
          inert={activeMobilePanel !== "feed"}
          className={[
            "w-full shrink-0 snap-start",
            activeMobilePanel === "feed"
              ? ""
              : "[&_[data-signal-feed-floating-navigation]]:hidden",
          ].join(" ")}
        >
          <UnifiedNewsPanel
            initialTelegramSnapshot={initialTelegramSnapshot}
            initialXSnapshot={initialXSnapshot}
            pollXSnapshot={pollXSnapshot}
          />
        </div>
        <div
          id={MOBILE_PANEL_ID.opportunities}
          role="tabpanel"
          aria-labelledby={MOBILE_TAB_ID.opportunities}
          aria-hidden={activeMobilePanel !== "opportunities"}
          inert={activeMobilePanel !== "opportunities"}
          className="w-full shrink-0 snap-start pl-3"
        >
          <OpportunityRadar />
        </div>
        <div
          id={MOBILE_PANEL_ID.summary}
          role="tabpanel"
          aria-labelledby={MOBILE_TAB_ID.summary}
          aria-hidden={activeMobilePanel !== "summary"}
          inert={activeMobilePanel !== "summary"}
          className="w-full shrink-0 snap-start pl-3"
        >
          <AlphaSummaryCard
            audience="signals"
            compact
            className="mobile-command-summary"
            deskLabel="Signals AI"
            endpoint="/api/signal-summary"
            showHeaderMeta={false}
          />
        </div>
      </div>
    </section>
  );
}
