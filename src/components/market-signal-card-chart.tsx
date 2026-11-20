import { CARD_CANDLE_COUNT, CARD_CANDLE_MS, CARD_WINDOW_MS } from "../lib/market-card-window";
import { getCardChart, type CardRow } from "./market-signal-card-model";

const WIDTH = 480;
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
});

export function cardTime(at: number) {
  return Number.isFinite(at) ? timeFormatter.format(at) : "—";
}

const MARK_COLOR = { burst: "text-warning", startup: "text-success", pumped: "text-warning", weakening: "text-danger", up: "text-info", down: "text-danger", squeeze: "text-warning" };

export function MarketSignalCardChart({ row, candles, endMs, compact = false }: {
  row: CardRow; candles: Parameters<typeof getCardChart>[0]; endMs: number; compact?: boolean;
}) {
  const { bars, marks, startMs, endMs: closedEndMs } = getCardChart(candles, endMs, row);
  const height = compact ? 80 : 160;
  const paddingY = compact ? 6 : 10;
  const low = Math.min(...bars.map(bar => bar.low));
  const high = Math.max(...bars.map(bar => bar.high));
  const x = (at: number) => 4 + (at - startMs) / CARD_WINDOW_MS * (WIDTH - 8);
  const y = (price: number) => high === low ? height / 2 : paddingY + (high - price) / (high - low) * (height - 2 * paddingY);
  // Scale the candles to the observed trading range. A trigger in a data gap can lie outside it.
  const markY = (price: number) => price > high ? paddingY : price < low ? height - paddingY : y(price);
  const paths = { up: { wick: "", body: "" }, down: { wick: "", body: "" } };
  for (const bar of bars) {
    const at = x(bar.at + CARD_CANDLE_MS / 2).toFixed(2);
    const path = paths[bar.close >= bar.open ? "up" : "down"];
    path.wick += `M${at} ${y(bar.high).toFixed(2)}V${y(bar.low).toFixed(2)}`;
    const top = y(Math.max(bar.open, bar.close));
    const bottom = Math.max(top + 1.2, y(Math.min(bar.open, bar.close)));
    path.body += `M${at} ${top.toFixed(2)}V${bottom.toFixed(2)}`;
  }
  const labels = marks.slice(0, 2);
  const stacked = labels.length === 2 && Math.abs(labels[1].at - labels[0].at) < CARD_WINDOW_MS * 0.40;
  const chartDescription = `${row.symbol} 4h 走势，已采集 ${bars.length} 根 5m K 线`;
  const markerDescription = labels.map(mark => `${mark.label} ${cardTime(mark.at)}`).join("、");
  return (
    <figure className="min-w-0">
      {(bars.length > 0 || !compact) && <figcaption className={`flex flex-wrap items-baseline justify-between gap-x-2 text-muted ${compact ? "mb-0.5 text-[10px] leading-3" : "mb-2 text-xs font-semibold"}`}>
        <span>4h · 5m K 线</span>
        {bars.length > 0 ? <span className="text-[10px] font-normal tabular-nums">
          {bars.length < CARD_CANDLE_COUNT ? `${bars.length}/${CARD_CANDLE_COUNT} 根 · ` : ""}区间振幅 {((high / low - 1) * 100).toFixed(2)}%
        </span> : null}
      </figcaption>}
      {bars.length ? (
        <>
          {!compact && <div className={`relative ${stacked ? "h-9" : "h-5"}`}>
            {labels.map((mark, index) => {
              const position = (mark.at - startMs) / CARD_WINDOW_MS;
              return <span key={`${mark.kind}-${mark.at}`} className={`absolute whitespace-nowrap text-[10px] font-semibold ${MARK_COLOR[mark.kind]}`}
                style={{ left: `${position * 100}%`, top: stacked ? index * 15 : 0, transform: `translateX(-${position * 100}%)` }}>
                {mark.label} {cardTime(mark.at)}
              </span>;
            })}
          </div>}
          <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" className={`block w-full ${compact ? "h-20" : "h-40 sm:h-44"}`} role="img"
            aria-label={compact && markerDescription ? `${chartDescription}，触发点：${markerDescription}` : chartDescription}>
            {(compact ? [height / 2] : [10, height / 2, height - 6]).map(gridY => <line key={gridY} x1="0" x2={WIDTH} y1={gridY} y2={gridY} stroke="var(--line)" />)}
            {(["up", "down"] as const).map(side => (
              <g key={side} stroke={side === "up" ? "var(--success)" : "var(--danger)"} fill="none">
                <path d={paths[side].wick} strokeWidth={1} />
                <path d={paths[side].body} strokeWidth={6} />
              </g>
            ))}
            {marks.map((mark, index) => (
              <g key={`${mark.at}-${index}`} data-marker={mark.kind} data-at={mark.at} className={MARK_COLOR[mark.kind]}>
                <title>{`${mark.label} ${cardTime(mark.at)} · ${mark.price} USDT${mark.price < low || mark.price > high ? "（超出已采样 K 线区间）" : ""}`}</title>
                {labels.includes(mark) ? <line x1={x(mark.at)} x2={x(mark.at)} y1="0" y2={markY(mark.price)} stroke="currentColor" strokeDasharray="2 2" opacity=".65" /> : null}
                <circle cx={x(mark.at)} cy={markY(mark.price)} r={compact ? 2.8 : 3.3} fill="currentColor" stroke="var(--workspace-surface)" strokeWidth={compact ? 1 : 1.3} />
              </g>
            ))}
          </svg>
          {!compact && <div className="mt-1 flex justify-between font-mono text-[10px] text-muted"><span>{cardTime(startMs)}</span><span>{cardTime(closedEndMs)}</span></div>}
        </>
      ) : <p className={`grid place-items-center rounded border border-dashed border-line text-muted ${compact ? "h-20 text-[10px]" : "h-40 text-xs sm:h-44"}`}>近 4 小时暂无完整 5m K 线</p>}
    </figure>
  );
}
