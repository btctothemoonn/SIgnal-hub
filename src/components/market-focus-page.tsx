import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MarketSignalsBoard } from "@/components/market-signals-board";
import { getBoardWorkerHealth } from "@/lib/market-alerts-health";
import type { MarketBoardMarket } from "@/lib/market-signals";
import { getMarketSignalsBoardData } from "@/lib/market-signals-view";

const markets = [
  { market: "crypto", href: "/alerts", label: "加密货币" },
  { market: "equities", href: "/alerts/equities", label: "美股与 ETF" },
] as const;

export function MarketFocusPage({ market }: { market: MarketBoardMarket }) {
  const data = getMarketSignalsBoardData(undefined, market);
  const { online, total } = getBoardWorkerHealth(data.health, market, Date.parse(data.generatedAt));
  const equities = market === "equities";

  return (
    <AppShell
      activeNav="alerts"
      subtitle={equities ? "美股合约 · 重点观察" : "异动 · 重点观察"}
      mainClassName="mx-auto min-h-0 w-full max-w-[1680px] px-3 py-3 sm:px-5 lg:py-4"
      statusPills={[{
        label: "异动",
        children: "实时行情",
        status: `${online}/${total} 在线`,
        tone: online === total ? "text-success" : "text-warning",
      }]}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="观察市场" className="inline-flex gap-1 rounded-lg border border-line bg-workspace-canvas p-1">
          {markets.map(item => <Link key={item.market} href={item.href} prefetch={false}
            aria-current={market === item.market ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${market === item.market ? "bg-workspace-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>
            {item.label}
          </Link>)}
        </nav>
        {equities ? <p className="text-xs text-muted">币安美股及 ETF 的 USDT 永续合约，涨跌按合约价格计算。</p> : null}
      </div>
      <MarketSignalsBoard key={market} initialData={data} />
    </AppShell>
  );
}
