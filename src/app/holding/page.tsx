import { AppShell } from "@/components/app-shell";
import { HoldingPanelLoader } from "@/components/holding-panel-loader";

export const dynamic = "force-dynamic";

export default function HoldingPage() {
  return (
    <AppShell
      activeNav="holding"
      subtitle="美股证券快照 / Binance 现货与合约持仓 · 只读面板"
      mainClassName="mx-auto w-full max-w-[1780px] min-h-0 px-3 py-4 sm:px-5"
      statusPills={[
        {
          label: "Holding",
          status: "只读",
          tone: "text-info",
          children: "US + Binance",
        },
      ]}
    >
      <HoldingPanelLoader />
    </AppShell>
  );
}
