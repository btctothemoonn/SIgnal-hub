import { AppShell } from "@/components/app-shell";
import { MarketSignalsBoard } from "@/components/market-signals-board";
import { getMarketAlertWorkerView } from "@/lib/market-alerts-health";
import { getMarketSignalsBoardData } from "@/lib/market-signals-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AlertsPage() {
  const data = getMarketSignalsBoardData();
  const nowMs = Date.parse(data.generatedAt);
  const liveWorkers = Object.values(data.health).filter(
    (heartbeat) => getMarketAlertWorkerView(heartbeat, nowMs).online,
  ).length;

  return (
    <AppShell
      activeNav="alerts"
      subtitle="异动 · 回调买点 · 蓄力与大波动预警"
      mainClassName="mx-auto min-h-0 w-full max-w-[1680px] px-3 py-3 sm:px-5 lg:py-4"
      statusPills={[
        {
          label: "异动",
          children: `24h ${data.events.length} 次触发`,
          status: `${liveWorkers}/4 在线`,
          tone: liveWorkers === 4 ? "text-success" : "text-warning",
        },
      ]}
    >
      <MarketSignalsBoard initialData={data} />
    </AppShell>
  );
}
