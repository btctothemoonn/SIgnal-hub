import { CARD_CANDLE_COUNT, CARD_CANDLE_MS, CARD_WINDOW_MS } from "../lib/market-card-window";
import { getCardChart, type CardRow } from "./market-signal-card-model";
import { getCardPriceTicks } from "./market-signal-price-axis";

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
  const height = compact ? 192 : 288;
  const paddingY = compact ? 8 : 12;
  const low = Math.min(...bars.map(bar => bar.low));
  const high = Math.max(...bars.map(bar => bar.high));
  const priceTicks = getCardPriceTicks(low, high, compact ? 3 : 5);
  const axisChars = Math.max(0, ...priceTicks.map(tick => tick.label.length));
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
        <span>4h · 5m K 线 · USDT</span>
        {bars.length > 0 ? <span className="text-[10px] font-normal tabular-nums">
          {bars.length < CARD_CANDLE_COUNT ? `${bars.length}/${CARD_CANDLE_COUNT} 根 · ` : ""}区间振幅 {((high / low - 1) * 100).toFixed(2)}%
        </span> : null}
      </figcaption>}
      {bars.length ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto]">
          {!compact && <div className={`relative col-start-1 ${stacked ? "h-9" : "h-5"}`}>
            {labels.map((mark, index) => {
              const position = (mark.at - startMs) / CARD_WINDOW_MS;
              return <span key={`${mark.kind}-${mark.at}`} className={`absolute whitespace-nowrap text-[10px] font-semibold ${MARK_COLOR[mark.kind]}`}
                style={{ left: `${position * 100}%`, top: stacked ? index * 15 : 0, transform: `translateX(-${position * 100}%)` }}>
                {mark.label} {cardTime(mark.at)}
              </span>;
            })}
          </div>}
          <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" className={`col-start-1 block w-full ${compact ? "h-48 sm:h-56" : "h-72 sm:h-80"}`} role="img"
            aria-label={compact && markerDescription ? `${chartDescription}，触发点：${markerDescription}` : chartDescription}>
            {priceTicks.map(tick => <line key={tick.price} x1="0" x2={WIDTH} y1={y(tick.price)} y2={y(tick.price)} stroke="var(--line)" />)}
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
          <div data-price-axis role="group" aria-label="价格轴（USDT）"
            className="relative col-start-2 border-l border-line font-mono text-[11px] leading-none tabular-nums text-muted"
            style={{ width: `${axisChars + 1.5}ch` }}>
            {priceTicks.map(tick => <span key={tick.price} data-price-tick={tick.price}
              className="absolute left-1.5 -translate-y-1/2 whitespace-nowrap"
              style={{ top: `${y(tick.price) / height * 100}%` }}>{tick.label}</span>)}
          </div>
          {!compact && <div className="col-start-1 mt-1 flex justify-between font-mono text-[10px] text-muted"><span>{cardTime(startMs)}</span><span>{cardTime(closedEndMs)}</span></div>}
        </div>
      ) : <p className={`grid place-items-center rounded border border-dashed border-line text-muted ${compact ? "h-20 text-[10px]" : "h-40 text-xs sm:h-44"}`}>近 4 小时暂无完整 5m K 线</p>}
    </figure>
  );
}
