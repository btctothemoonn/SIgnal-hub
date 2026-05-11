import { AlphaSummaryCard } from "@/components/alpha-summary-card";
import { AppShell } from "@/components/app-shell";
import { UnifiedNewsPanel } from "@/components/unified-news-panel";
import { getCached6551TwitterSnapshot } from "@/lib/6551-twitter";
import { buildSignalSourceStats } from "@/lib/signal-source-stats";
import { prepareTelegramSnapshotForClient } from "@/lib/telegram-client-snapshot";
import { getTelegramPipelineSnapshot } from "@/lib/telegram-pipeline-store";
import { getXPipelineSnapshot } from "@/lib/x-pipeline-store";
import { isXRestSnapshotMode } from "@/lib/x-snapshot-mode";

export const dynamic = "force-dynamic";

export default async function Home() {
  const pollXSnapshot = isXRestSnapshotMode();
  const [telegramSnapshot, xSnapshot] = await Promise.all([
    Promise.resolve(getTelegramPipelineSnapshot()),
    pollXSnapshot
      ? getCached6551TwitterSnapshot()
      : Promise.resolve(getXPipelineSnapshot()),
  ]);
  const sourceStats = buildSignalSourceStats({
    telegram: telegramSnapshot,
    x: xSnapshot,
  });

  return (
    <AppShell
      activeNav="signals"
      statusPills={[
        {
          label: "TG",
          status: sourceStats.telegramStatus,
          children: `${sourceStats.telegramChannels} 频道 · ${sourceStats.telegramItems} 条`,
        },
        {
          label: "X",
          status: sourceStats.xStatus,
          tone: "text-info",
          children: `${sourceStats.xItems} 条`,
        },
        {
          label: "985",
          status: sourceStats.monitor985Items > 0 ? "在线" : "待信号",
          tone: sourceStats.monitor985Items > 0 ? "text-accent" : "text-muted",
          children: `${sourceStats.monitor985Items} 条`,
        },
        {
          label: "Truth",
          status: sourceStats.truthStatus,
          tone: sourceStats.truthItems > 0 ? "text-success" : "text-muted",
          children: `${sourceStats.truthItems} 条`,
        },
      ]}
      mainClassName="mx-auto grid w-full max-w-[1780px] min-h-0 gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.58fr)_minmax(22rem,0.82fr)] lg:items-start xl:grid-cols-[minmax(0,1.72fr)_minmax(24rem,0.72fr)]"
    >
      <section id="signals" className="min-w-0">
        <UnifiedNewsPanel
          initialTelegramSnapshot={prepareTelegramSnapshotForClient(
            telegramSnapshot,
          )}
          initialXSnapshot={xSnapshot}
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
          className="lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain"
          deskLabel="Signals AI"
          endpoint="/api/signal-summary"
        />
      </aside>
    </AppShell>
  );
}
