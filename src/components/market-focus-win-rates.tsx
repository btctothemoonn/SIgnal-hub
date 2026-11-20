import type { MarketSignalsBoardData } from "@/lib/market-signals-view";

const HORIZONS = ["1h", "4h", "24h"] as const;
const SIGNALS = {
  pump: { label: "强暴涨", direction: "看涨" },
  crash: { label: "强暴跌", direction: "看跌" },
  squeeze: { label: "轧空", direction: "看涨" },
  startup: { label: "启动候选", direction: "看涨" },
  weakening: { label: "大涨后转弱", direction: "看跌" },
} as const;
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });

export function MarketFocusWinRates({ rates }: { rates: MarketSignalsBoardData["focusWinRates"] }) {
  return (
    <section aria-labelledby="focus-win-rate-heading" className="min-w-0 rounded-lg border border-line bg-workspace-surface px-3 py-3 sm:px-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="focus-win-rate-heading" className="text-base font-semibold text-foreground">信号胜率</h2>
        <span className="text-xs text-muted">近 {rates.windowDays} 天 · 当前市场全部重点触发</span>
      </header>
      <table aria-labelledby="focus-win-rate-heading" className="w-full table-fixed border-collapse text-right text-xs tabular-nums">
        <thead className="border-b border-line text-muted">
          <tr>
            <th scope="col" className="w-[34%] py-1.5 text-left font-medium sm:w-2/5">信号方向</th>
            {HORIZONS.map(horizon => <th key={horizon} scope="col" className="py-1.5 font-medium">{horizon} 后</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rates.rows.map(({ kind, total, horizons }) => (
            <tr key={kind}>
              <th scope="row" className="py-1.5 text-left align-middle font-normal">
                <span className="block font-semibold text-foreground">{SIGNALS[kind].label}</span>
                <span className="text-[10px] text-muted sm:text-[11px]">{SIGNALS[kind].direction} · {total} 次触发</span>
              </th>
              {HORIZONS.map(horizon => {
                const { wins, settled } = horizons[horizon];
                return (
                  <td key={horizon} className="py-1.5 align-middle">
                    <span className="block font-semibold text-foreground">{settled ? percent.format(wins / settled) : "—"}</span>
                    <span className="text-[10px] text-muted sm:text-[11px]">{wins}/{settled}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
        每格显示胜率和命中数/已结算数。到期价格相对触发价沿标注方向变动算命中，平盘算未命中。未到期或缺少行情的样本暂不计入。
        同一标的多次触发分别计数，结果仅反映价格方向。
      </p>
    </section>
  );
}
