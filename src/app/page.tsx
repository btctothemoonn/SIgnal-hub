import { AppShell } from "@/components/app-shell";
import { SignalsResponsiveLayout } from "@/components/signals-responsive-layout";
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
      mainClassName="mx-auto w-full max-w-[1780px] min-h-0 px-3 py-3 sm:px-5 lg:py-4"
    >
      <SignalsResponsiveLayout
        initialTelegramSnapshot={prepareTelegramSnapshotForClient(
          telegramSnapshot,
        )}
        initialXSnapshot={xSnapshot}
        pollXSnapshot={pollXSnapshot}
      />
    </AppShell>
  );
}
