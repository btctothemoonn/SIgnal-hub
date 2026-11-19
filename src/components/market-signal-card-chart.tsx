import { getCardChart, HOUR_MS, type CardRow } from "./market-signal-card-model";

const WIDTH = 480;
const HEIGHT = 118;
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
});

export function cardTime(at: number) {
  return Number.isFinite(at) ? timeFormatter.format(at) : "—";
}

const MARK_COLOR = { burst: "text-warning", startup: "text-success", pumped: "text-warning", weakening: "text-danger", up: "text-info", down: "text-danger", squeeze: "text-warning" };

export function MarketSignalCardChart({ row, candles, endMs }: {
  row: CardRow; candles: Parameters<typeof getCardChart>[0]; endMs: number;
}) {
  const { bars, marks, startMs } = getCardChart(candles, endMs, row);
  const low = Math.min(...bars.map(bar => bar.low), ...marks.map(mark => mark.price));
  const high = Math.max(...bars.map(bar => bar.high), ...marks.map(mark => mark.price));
  const x = (at: number) => 4 + (at - startMs) / HOUR_MS * (WIDTH - 8);
  const y = (price: number) => high === low ? HEIGHT / 2 : 12 + (high - price) / (high - low) * (HEIGHT - 24);
  const paths = { up: { wick: "", body: "" }, down: { wick: "", body: "" } };
  for (const bar of bars) {
    const at = x(bar.at + 30_000).toFixed(2);
    const path = paths[bar.close >= bar.open ? "up" : "down"];
    path.wick += `M${at} ${y(bar.high).toFixed(2)}V${y(bar.low).toFixed(2)}`;
    const top = y(Math.max(bar.open, bar.close));
    const bottom = Math.max(top + 1.2, y(Math.min(bar.open, bar.close)));
    path.body += `M${at} ${top.toFixed(2)}V${bottom.toFixed(2)}`;
  }
  const labels = marks.slice(0, 2);
  const stacked = labels.length === 2 && Math.abs(labels[1].at - labels[0].at) < HOUR_MS * 0.40;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 text-xs font-semibold text-muted">
        近 1 小时 / 1 分钟 K 线
        {bars.length && bars.length < 60 ? <span className="text-[10px] font-normal">{bars.length} 根已采集</span> : null}
      </figcaption>
      {bars.length ? (
        <>
          <div className={`relative ${stacked ? "h-9" : "h-5"}`}>
            {labels.map((mark, index) => {
              const position = (mark.at - startMs) / HOUR_MS;
              return <span key={`${mark.kind}-${mark.at}`} className={`absolute whitespace-nowrap text-[10px] font-semibold ${MARK_COLOR[mark.kind]}`}
                style={{ left: `${position * 100}%`, top: stacked ? index * 15 : 0, transform: `translateX(-${position * 100}%)` }}>
                {mark.label} {cardTime(mark.at)}
              </span>;
            })}
          </div>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block h-24 w-full sm:h-28" role="img"
            aria-label={`${row.symbol} 最近一小时已采集的 ${bars.length} 根一分钟 K 线`}>
            {[10, HEIGHT / 2, HEIGHT - 6].map(gridY => <line key={gridY} x1="0" x2={WIDTH} y1={gridY} y2={gridY} stroke="var(--line)" />)}
            {(["up", "down"] as const).map(side => (
              <g key={side} stroke={side === "up" ? "var(--success)" : "var(--danger)"} fill="none">
                <path d={paths[side].wick} strokeWidth={1} />
                <path d={paths[side].body} strokeWidth={4.6} />
              </g>
            ))}
            {marks.map((mark, index) => (
              <g key={`${mark.at}-${index}`} data-marker={mark.kind} data-at={mark.at} className={MARK_COLOR[mark.kind]}>
                <title>{mark.label} {cardTime(mark.at)} · {mark.price} USDT</title>
                {labels.includes(mark) ? <line x1={x(mark.at)} x2={x(mark.at)} y1="0" y2={y(mark.price)} stroke="currentColor" strokeDasharray="2 2" opacity=".65" /> : null}
                <circle cx={x(mark.at)} cy={y(mark.price)} r="3.3" fill="currentColor" stroke="var(--workspace-surface)" strokeWidth="1.3" />
              </g>
            ))}
          </svg>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted"><span>{cardTime(startMs)}</span><span>{cardTime(endMs)}</span></div>
        </>
      ) : <p className="grid min-h-20 place-items-center rounded border border-dashed border-line text-xs text-muted">近一小时暂无 K 线采样</p>}
    </figure>
  );
}
