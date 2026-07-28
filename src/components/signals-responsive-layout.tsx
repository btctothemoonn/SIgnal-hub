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
import type { TelegramDashboardSnapshot } from "@/lib/telegram-channels";

type SignalMobilePanel = "feed" | "summary";

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
    setActiveMobilePanel(panel);
    const scroller = mobileScrollerRef.current;
    if (!scroller) return;

    scroller.scrollTo({
      left: scroller.clientWidth * MOBILE_PANEL_INDEX[panel],
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

    const nextPanel =
      scroller.scrollLeft >= scroller.clientWidth * 0.5 ? "summary" : "feed";
    setActiveMobilePanel((current) =>
      current === nextPanel ? current : nextPanel,
    );
  }, []);

  if (isDesktop === null) {
    return (
      <div className="min-h-[24rem] rounded-lg border border-line/70 bg-panel/70" />
    );
  }

  if (isDesktop) {
    return (
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1.42fr)_minmax(26rem,0.95fr)] lg:items-start lg:gap-4 xl:grid-cols-[minmax(0,1.52fr)_minmax(30rem,0.88fr)]">
        <section id="signals" className="min-w-0">
          <SignalFeedStack
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

  return (
    <section
      ref={mobilePagerRef}
      data-mobile-signal-pager
      className="min-w-0 scroll-mt-[5.25rem]"
    >
      <div className="mb-3 rounded-lg border border-line/70 bg-panel-strong/95 p-1 shadow-[0_18px_36px_-32px_rgba(0,0,0,0.7)]">
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
          <SignalFeedStack
            initialTelegramSnapshot={initialTelegramSnapshot}
            initialXSnapshot={initialXSnapshot}
            pollXSnapshot={pollXSnapshot}
          />
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
