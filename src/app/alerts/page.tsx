import { AppShell } from "@/components/app-shell";
import { MarketAlertsPanel } from "@/components/market-alerts-panel";
import { getMarketAlertWorkerView } from "@/lib/market-alerts-health";
import { getMarketAlertsSnapshot } from "@/lib/market-alerts-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AlertsPage() {
  const snapshot = getMarketAlertsSnapshot({ limit: 100 });
  const nowMs = Date.parse(snapshot.generatedAt);
  const liveWorkers = Object.values(snapshot.health).filter(
    (heartbeat) => getMarketAlertWorkerView(heartbeat, nowMs).online,
  ).length;

  return (
    <AppShell
      activeNav="alerts"
      subtitle="异动监控 · 暴涨暴跌 · 轧空预警"
      mainClassName="mx-auto min-h-0 w-full max-w-[1680px] px-3 py-3 sm:px-5 lg:py-4"
      statusPills={[
        {
          label: "异动",
          children: `${snapshot.activeSignals.length} 活跃 · ${snapshot.total} 记录`,
          status: `${liveWorkers}/3 在线`,
          tone: liveWorkers === 3 ? "text-success" : "text-warning",
        },
      ]}
    >
      <MarketAlertsPanel initialSnapshot={snapshot} />
    </AppShell>
  );
}
