"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlphaSummaryCard } from "@/components/alpha-summary-card";
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

export function SignalsResponsiveLayout({
  initialTelegramSnapshot,
  initialXSnapshot,
  pollXSnapshot,
}: SignalsResponsiveLayoutProps) {
  const mobileScrollerRef = useRef<HTMLDivElement | null>(null);
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

  const showMobilePanel = useCallback((panel: SignalMobilePanel) => {
    setActiveMobilePanel(panel);
    const scroller = mobileScrollerRef.current;
    if (!scroller) return;

    const index = panel === "feed" ? 0 : 1;
    scroller.scrollTo({
      left: scroller.clientWidth * index,
      behavior: "smooth",
    });
  }, []);

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
