"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlphaSummaryCard } from "@/components/alpha-summary-card";
import { StocksHynixPremiumCurve } from "@/components/stocks-hynix-premium-curve";
import { UnifiedNewsPanel } from "@/components/unified-news-panel";
import type { TwitterDashboardSnapshot } from "@/lib/6551-twitter";
import {
  reduceSignalMobilePanelScroll,
  type SignalMobilePanel,
  type SignalMobilePanelScrollState,
} from "@/lib/signal-mobile-panel-scroll";
import type { TelegramDashboardSnapshot } from "@/lib/telegram-channels";

type SignalsResponsiveLayoutProps = {
  initialTelegramSnapshot: TelegramDashboardSnapshot;
  initialXSnapshot: TwitterDashboardSnapshot;
  pollXSnapshot: boolean;
};

const mobilePanels: Array<{ id: SignalMobilePanel; label: string }> = [
  { id: "feed", label: "最新推送" },
  { id: "summary", label: "AI 总结" },
];

const MOBILE_PANEL_INDEX = {
  feed: 0,
  summary: 1,
} as const;

const MOBILE_TAB_ID: Record<SignalMobilePanel, string> = {
  feed: "signal-mobile-tab-feed",
  summary: "signal-mobile-tab-summary",
};

const MOBILE_PANEL_ID: Record<SignalMobilePanel, string> = {
  feed: "signal-mobile-panel-feed",
  summary: "signal-mobile-panel-summary",
};

function SignalFeedStack({
  initialTelegramSnapshot,
  initialXSnapshot,
  pollXSnapshot,
  rail = false,
}: SignalsResponsiveLayoutProps & { rail?: boolean }) {
  return (
    <div className="min-w-0 space-y-3">
      <StocksHynixPremiumCurve />
      <UnifiedNewsPanel
        initialTelegramSnapshot={initialTelegramSnapshot}
        initialXSnapshot={initialXSnapshot}
        pollXSnapshot={pollXSnapshot}
        rail={rail}
      />
    </div>
  );
}

export function SignalsResponsiveLayout({
  initialTelegramSnapshot,
  initialXSnapshot,
  pollXSnapshot,
}: SignalsResponsiveLayoutProps) {
  const mobilePagerRef = useRef<HTMLElement | null>(null);
  const mobileScrollerRef = useRef<HTMLDivElement | null>(null);
  const mobileReturnScrollYRef = useRef<number | null>(null);
  const previousMobilePanelRef = useRef<SignalMobilePanel>("feed");
  const mobilePanelScrollStateRef = useRef<SignalMobilePanelScrollState>({
    activePanel: "feed",
    programmaticTarget: null,
  });
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [activeMobilePanel, setActiveMobilePanel] =
    useState<SignalMobilePanel>("feed");

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncLayout = () => setIsDesktop(media.matches);

    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (isDesktop !== false) return;

    const previousPanel = previousMobilePanelRef.current;
    previousMobilePanelRef.current = activeMobilePanel;

    if (activeMobilePanel !== "summary") {
      if (previousPanel === "summary") {
        const returnScrollY = mobileReturnScrollYRef.current;
        mobileReturnScrollYRef.current = null;
        if (returnScrollY !== null) {
          window.scrollTo({ top: returnScrollY, behavior: "auto" });
        }
      }
      return;
    }

    if (previousPanel === "summary") return;
    mobileReturnScrollYRef.current = window.scrollY;
    mobilePagerRef.current?.scrollIntoView({
      behavior: "auto",
      block: "start",
    });
  }, [activeMobilePanel, isDesktop]);

  const showMobilePanel = useCallback((panel: SignalMobilePanel) => {
    const scroller = mobileScrollerRef.current;
    const clientWidth = scroller?.clientWidth ?? 0;
    let nextScrollState = reduceSignalMobilePanelScroll(
      mobilePanelScrollStateRef.current,
      {
        type: "programmatic-start",
        target: panel,
        clientWidth,
      },
    );
    if (!scroller || clientWidth <= 0) return;

    nextScrollState = reduceSignalMobilePanelScroll(nextScrollState, {
      type: "scroll",
      scrollLeft: scroller.scrollLeft,
      clientWidth,
    });
    mobilePanelScrollStateRef.current = nextScrollState;
    setActiveMobilePanel(nextScrollState.activePanel);

    scroller.scrollTo({
      left: clientWidth * MOBILE_PANEL_INDEX[panel],
      behavior: "smooth",
    });
  }, []);

  const handleMobileTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, panel: SignalMobilePanel) => {
      const currentIndex = MOBILE_PANEL_INDEX[panel];
      let nextIndex: number;

      if (event.key === "ArrowLeft") {
        nextIndex =
          (currentIndex + mobilePanels.length - 1) % mobilePanels.length;
      } else if (event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % mobilePanels.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = mobilePanels.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      const nextPanel = mobilePanels[nextIndex].id;
      showMobilePanel(nextPanel);
      document.getElementById(MOBILE_TAB_ID[nextPanel])?.focus();
    },
    [showMobilePanel],
  );

  const handleMobileScroll = useCallback(() => {
    const scroller = mobileScrollerRef.current;
    if (!scroller) return;

    const nextScrollState = reduceSignalMobilePanelScroll(
      mobilePanelScrollStateRef.current,
      {
        type: "scroll",
        scrollLeft: scroller.scrollLeft,
        clientWidth: scroller.clientWidth,
      },
    );
    mobilePanelScrollStateRef.current = nextScrollState;
    setActiveMobilePanel((current) =>
      current === nextScrollState.activePanel
        ? current
        : nextScrollState.activePanel,
    );
  }, []);

  const handleMobileScrollStart = useCallback(() => {
    mobilePanelScrollStateRef.current = reduceSignalMobilePanelScroll(
      mobilePanelScrollStateRef.current,
      { type: "user-interrupt" },
    );
  }, []);

  if (isDesktop === null) {
    return (
      <div
        data-signal-workspace
        className="min-h-[24rem] rounded-[6px] border border-workspace-line-strong bg-workspace-surface"
      />
    );
  }

  if (isDesktop) {
    return (
      <div
        data-signal-workspace
        className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(20rem,3fr)] lg:items-start lg:gap-4"
      >
        <section id="signals" data-signal-feed-pane className="min-w-0">
          <SignalFeedStack
            initialTelegramSnapshot={initialTelegramSnapshot}
            initialXSnapshot={initialXSnapshot}
            pollXSnapshot={pollXSnapshot}
            rail
          />
        </section>

        <aside
          id="alpha"
          data-signal-summary-pane
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

  return (
    <section
      ref={mobilePagerRef}
      data-mobile-signal-pager
      data-signal-workspace
      className="min-w-0 scroll-mt-[5.25rem]"
    >
      <div className="mb-3 rounded-[6px] border border-workspace-line-strong bg-workspace-toolbar p-1">
        <div
          role="tablist"
          aria-label="Signal Flow 移动视图"
          className="grid grid-cols-2 gap-1"
        >
          {mobilePanels.map((panel) => (
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
                  ? "bg-foreground text-background"
                  : "text-muted hover:bg-workspace-surface hover:text-foreground",
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
        onPointerDown={handleMobileScrollStart}
        onTouchStart={handleMobileScrollStart}
        className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          id={MOBILE_PANEL_ID.feed}
          data-signal-feed-pane
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
          <SignalFeedStack
            initialTelegramSnapshot={initialTelegramSnapshot}
            initialXSnapshot={initialXSnapshot}
            pollXSnapshot={pollXSnapshot}
          />
        </div>
        <div
          id={MOBILE_PANEL_ID.summary}
          data-signal-summary-pane
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
