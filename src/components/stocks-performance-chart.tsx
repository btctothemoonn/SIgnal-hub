"use client";

import type {
  AlphaResearchSector,
  AlphaResearchStock,
} from "@/lib/alpha-research-pool";
import type { StocksPerformanceSnapshot } from "@/lib/stocks-performance-data";

type StocksPerformanceChartProps = {
  snapshot: StocksPerformanceSnapshot | null;
  stocks: AlphaResearchStock[];
  tickers: string[];
  sectors: AlphaResearchSector[];
  activeSectorId: string;
  onSelectSector: (sectorId: string) => void;
  loading: boolean;
};

const palette = [
  "#d8e36f",
  "#b7d8f3",
  "#e4a8df",
  "#8f85f0",
  "#f5a5b8",
  "#b7b8da",
  "#8fd6c2",
];

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function linePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function StocksPerformanceChart({
  snapshot,
  stocks,
  tickers,
  sectors,
  activeSectorId,
  onSelectSector,
  loading,
}: StocksPerformanceChartProps) {
  const stockNames = new Map(stocks.map((stock) => [stock.ticker, stock.companyName]));
  const series = (snapshot?.series ?? []).filter((item) =>
    tickers.includes(item.ticker),
  );
  const allPoints = series.flatMap((item) => item.points);
  const minTime = Math.min(
    ...allPoints.map((point) => Date.parse(point.capturedAt)),
  );
  const maxTime = Math.max(
    ...allPoints.map((point) => Date.parse(point.capturedAt)),
  );
  const minChange = Math.min(0, ...allPoints.map((point) => point.changePct));
  const maxChange = Math.max(0, ...allPoints.map((point) => point.changePct));
  const yPad = Math.max(2, (maxChange - minChange) * 0.18);
  const yMin = minChange - yPad;
  const yMax = maxChange + yPad;
  const plot = { left: 42, right: 604, top: 28, bottom: 222 };
  const width = plot.right - plot.left;
  const height = plot.bottom - plot.top;
  const timeSpan = maxTime - minTime || 1;
  const valueSpan = yMax - yMin || 1;
  const hasData = series.length > 0 && allPoints.length > 0;
  const newestAt =
    hasData && Number.isFinite(maxTime) ? new Date(maxTime).toISOString() : "";

  const toX = (capturedAt: string) =>
    plot.left + ((Date.parse(capturedAt) - minTime) / timeSpan) * width;
  const toY = (changePct: number) =>
    plot.bottom - ((changePct - yMin) / valueSpan) * height;

  return (
    <section className="overflow-hidden rounded-lg border border-line/70 bg-[#10141f] shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">
          <div className="min-w-[12rem]">
            <h2 className="text-sm font-semibold text-white">今日相对涨跌幅</h2>
            <p className="mt-1 text-xs text-slate-300">
              {tickers.join(", ")} · 基准为今天第一条本地缓存价
            </p>
          </div>
          <div className="flex max-w-full flex-wrap gap-1 rounded-md border border-white/10 bg-white/5 p-1">
            {sectors.map((sector) => {
              const selected = sector.id === activeSectorId;
              return (
                <button
                  key={sector.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectSector(sector.id)}
                  title={sector.tickers.join(", ")}
                  className={[
                    "rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                    selected
                      ? "bg-white text-[#10141f]"
                      : "text-slate-300 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  {sector.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-medium">
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
            {snapshot?.marketDate ?? "等待缓存"}
          </span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-200">
            {hasData ? `更新 ${formatTime(newestAt)}` : loading ? "加载中" : "暂无数据"}
          </span>
        </div>
      </div>

      <div className="relative">
        {!hasData ? (
          <div className="flex min-h-[17rem] items-center justify-center px-6 text-center text-sm text-slate-300">
            {loading
              ? "正在读取本地行情缓存..."
              : "等待下一次行情刷新写入缓存后开始画线。"}
          </div>
        ) : (
          <svg
            viewBox="0 0 720 260"
            role="img"
            aria-label="今日股票相对涨跌幅对比图"
            className="h-auto w-full"
          >
            <rect x="0" y="0" width="720" height="260" fill="#10141f" />
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = plot.top + ratio * height;
              const value = yMax - ratio * valueSpan;
              return (
                <g key={`y-${ratio}`}>
                  <line
                    x1={plot.left}
                    x2={plot.right}
                    y1={y}
                    y2={y}
                    stroke="rgba(255,255,255,0.08)"
                  />
                  <text
                    x={plot.right + 10}
                    y={y + 4}
                    fill="#cbd5e1"
                    fontSize="10"
                  >
                    {formatSignedPercent(value)}
                  </text>
                </g>
              );
            })}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const x = plot.left + ratio * width;
              return (
                <line
                  key={`x-${ratio}`}
                  x1={x}
                  x2={x}
                  y1={plot.top}
                  y2={plot.bottom}
                  stroke="rgba(255,255,255,0.08)"
                />
              );
            })}
            <line
              x1={plot.left}
              x2={plot.right}
              y1={toY(0)}
              y2={toY(0)}
              stroke="rgba(255,255,255,0.25)"
            />
            {series.map((item, index) => {
              const color = palette[index % palette.length];
              const points = item.points.map((point) => ({
                x: toX(point.capturedAt),
                y: toY(point.changePct),
              }));
              const latest = item.points[item.points.length - 1];
              const latestX = latest ? toX(latest.capturedAt) : plot.left;
              const latestY = latest ? toY(latest.changePct) : plot.bottom;
              const labelY = Math.max(plot.top + 10, Math.min(plot.bottom - 10, latestY));
              return (
                <g key={item.ticker}>
                  <path
                    d={linePath(points)}
                    fill="none"
                    stroke={color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                  <circle cx={latestX} cy={latestY} r="2.4" fill={color} />
                  <line
                    x1={latestX + 4}
                    x2={plot.right + 24}
                    y1={latestY}
                    y2={labelY}
                    stroke={color}
                    strokeOpacity="0.45"
                  />
                  <rect
                    x={plot.right + 24}
                    y={labelY - 10}
                    width="92"
                    height="20"
                    rx="2"
                    fill={color}
                    opacity="0.95"
                  />
                  <text
                    x={plot.right + 30}
                    y={labelY + 4}
                    fill="#111827"
                    fontSize="10"
                    fontWeight="700"
                  >
                    {item.ticker} {formatSignedPercent(item.latestChangePct)}
                  </text>
                </g>
              );
            })}
            <text x={plot.left} y={244} fill="#cbd5e1" fontSize="10">
              {formatTime(new Date(minTime).toISOString())}
            </text>
            <text x={plot.right - 38} y={244} fill="#cbd5e1" fontSize="10">
              {formatTime(new Date(maxTime).toISOString())}
            </text>
          </svg>
        )}
      </div>

      {hasData ? (
        <div className="grid gap-1 border-t border-white/10 px-4 py-3 text-[11px] text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((item, index) => (
            <div key={item.ticker} className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: palette[index % palette.length] }}
              />
              <span className="truncate">
                {item.ticker} · {stockNames.get(item.ticker) ?? item.ticker}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
