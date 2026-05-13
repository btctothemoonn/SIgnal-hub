"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type {
  AlphaResearchSector,
  AlphaResearchStock,
} from "@/lib/alpha-research-pool";
import { packChartLabelPositions } from "@/lib/chart-label-layout";
import type { StocksPerformanceSnapshot } from "@/lib/stocks-performance-data";

type StocksPerformanceChartProps = {
  snapshot: StocksPerformanceSnapshot | null;
  stocks: AlphaResearchStock[];
  tickers: string[];
  sectors: AlphaResearchSector[];
  activeSectorId: string;
  onSelectSector: (sectorId: string) => void;
  loading: boolean;
  compact?: boolean;
};

type ZoomRange = {
  start: number;
  end: number;
};

type ZoomState = {
  key: string;
  range: ZoomRange;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  range: ZoomRange;
};

type PerformancePoint = StocksPerformanceSnapshot["series"][number]["points"][number];

const palette = [
  "#d8e36f",
  "#b7d8f3",
  "#e4a8df",
  "#8f85f0",
  "#f5a5b8",
  "#b7b8da",
  "#8fd6c2",
];

const FULL_ZOOM_RANGE: ZoomRange = { start: 0, end: 1 };
const MIN_ZOOM_SPAN = 0.08;
const SVG_WIDTH = 720;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampZoomRange(start: number, end: number): ZoomRange {
  const span = clamp(end - start, MIN_ZOOM_SPAN, 1);
  const nextStart = clamp(start, 0, 1 - span);
  return { start: nextStart, end: nextStart + span };
}

function zoomRangeAround(
  range: ZoomRange,
  focusRatio: number,
  scale: number,
): ZoomRange {
  const span = range.end - range.start;
  const nextSpan = clamp(span * scale, MIN_ZOOM_SPAN, 1);
  const focus = range.start + span * clamp(focusRatio, 0, 1);
  const start = focus - nextSpan * focusRatio;
  return clampZoomRange(start, start + nextSpan);
}

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

function formatAxisTime(value: string, includeDate: boolean) {
  const date = new Date(value);
  return includeDate
    ? date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
}

function linePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function createTradingTimeAxis(points: PerformancePoint[]) {
  const times = Array.from(
    new Set(
      points
        .map((point) => Date.parse(point.capturedAt))
        .filter((time) => Number.isFinite(time)),
    ),
  ).sort((a, b) => a - b);
  const timeIndexByMs = new Map(times.map((time, index) => [time, index]));

  return { times, timeIndexByMs };
}

export function StocksPerformanceChart({
  snapshot,
  stocks,
  tickers,
  sectors,
  activeSectorId,
  onSelectSector,
  loading,
  compact = false,
}: StocksPerformanceChartProps) {
  const [zoomState, setZoomState] = useState<ZoomState>({
    key: "",
    range: FULL_ZOOM_RANGE,
  });
  const dragState = useRef<DragState | null>(null);
  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const stockNames = new Map(
    stocks.map((stock) => [stock.ticker, stock.companyNameZh]),
  );
  const series = (snapshot?.series ?? []).filter((item) =>
    tickers.includes(item.ticker),
  );
  const allPoints = series.flatMap((item) => item.points);
  const { times: axisTimes, timeIndexByMs } = createTradingTimeAxis(allPoints);
  const minTime = axisTimes[0] ?? Number.NaN;
  const maxTime = axisTimes.at(-1) ?? Number.NaN;
  const visibleRangeKey = [
    activeSectorId,
    tickers.join(","),
    snapshot?.marketDate ?? "",
    axisTimes.length,
    Number.isFinite(minTime) ? minTime : "empty",
    Number.isFinite(maxTime) ? maxTime : "empty",
  ].join("|");
  const zoomRange =
    zoomState.key === visibleRangeKey ? zoomState.range : FULL_ZOOM_RANGE;
  const axisMaxIndex = Math.max(0, axisTimes.length - 1);
  const visibleStartIndex = axisMaxIndex * zoomRange.start;
  const visibleEndIndex = axisMaxIndex * zoomRange.end;
  const axisIndexForCapturedAt = (capturedAt: string) =>
    timeIndexByMs.get(Date.parse(capturedAt)) ?? 0;
  const visiblePoints = allPoints.filter((point) => {
    const index = axisIndexForCapturedAt(point.capturedAt);
    return index >= visibleStartIndex && index <= visibleEndIndex;
  });
  const yPoints = visiblePoints.length > 0 ? visiblePoints : allPoints;
  const minChange = Math.min(0, ...yPoints.map((point) => point.changePct));
  const maxChange = Math.max(0, ...yPoints.map((point) => point.changePct));
  const yPad = Math.max(2, (maxChange - minChange) * 0.18);
  const yMin = minChange - yPad;
  const yMax = maxChange + yPad;
  const viewBoxHeight = compact ? 220 : 260;
  const plot = compact
    ? { left: 42, right: 604, top: 24, bottom: 184 }
    : { left: 42, right: 604, top: 28, bottom: 222 };
  const axisLabelY = compact ? 204 : 244;
  const width = plot.right - plot.left;
  const height = plot.bottom - plot.top;
  const axisSpan = visibleEndIndex - visibleStartIndex || 1;
  const valueSpan = yMax - yMin || 1;
  const hasData = series.length > 0 && allPoints.length > 0;
  const newestAt =
    hasData && Number.isFinite(maxTime) ? new Date(maxTime).toISOString() : "";
  const hasMultipleMarketDates = new Set(
    allPoints.map((point) => point.marketDate),
  ).size > 1;

  const toX = (capturedAt: string) =>
    plot.left +
    ((axisIndexForCapturedAt(capturedAt) - visibleStartIndex) / axisSpan) *
      width;
  const toY = (changePct: number) =>
    plot.bottom - ((changePct - yMin) / valueSpan) * height;
  const labelYByTicker = packChartLabelPositions(
    series.flatMap((item) => {
      const labelPoint = [...item.points].reverse().find((point) => {
        const index = axisIndexForCapturedAt(point.capturedAt);
        return index >= visibleStartIndex && index <= visibleEndIndex;
      });
      return labelPoint
        ? [{ id: item.ticker, y: toY(labelPoint.changePct) }]
        : [];
    }),
    {
      minY: plot.top + 10,
      maxY: plot.bottom - 10,
      minGap: 22,
    },
  );
  const setCurrentZoomRange = useCallback(
    (nextRange: ZoomRange | ((range: ZoomRange) => ZoomRange)) => {
      setZoomState((state) => {
        const currentRange =
          state.key === visibleRangeKey ? state.range : FULL_ZOOM_RANGE;
        const range =
          typeof nextRange === "function" ? nextRange(currentRange) : nextRange;

        if (
          state.key === visibleRangeKey &&
          state.range.start === range.start &&
          state.range.end === range.end
        ) {
          return state;
        }

        return { key: visibleRangeKey, range };
      });
    },
    [visibleRangeKey],
  );
  const resetZoom = () => setCurrentZoomRange(FULL_ZOOM_RANGE);
  const zoomFromCenter = (scale: number) => {
    setCurrentZoomRange((range) => zoomRangeAround(range, 0.5, scale));
  };
  useEffect(() => {
    const svg = chartSvgRef.current;
    if (!svg || !hasData) return;

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const bounds = svg.getBoundingClientRect();
      if (bounds.width <= 0) return;

      const viewBoxX =
        ((event.clientX - bounds.left) / bounds.width) * SVG_WIDTH;
      const focusRatio = clamp((viewBoxX - plot.left) / width, 0, 1);
      setCurrentZoomRange((range) =>
        zoomRangeAround(range, focusRatio, event.deltaY > 0 ? 1.18 : 0.82),
      );
    };

    svg.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handleNativeWheel);
    };
  }, [hasData, plot.left, setCurrentZoomRange, width]);
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!hasData) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      range: zoomRange,
    };
  };
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewBoxDelta = ((event.clientX - drag.startClientX) / bounds.width) * SVG_WIDTH;
    const span = drag.range.end - drag.range.start;
    const rangeDelta = -(viewBoxDelta / width) * span;
    setCurrentZoomRange(
      clampZoomRange(drag.range.start + rangeDelta, drag.range.end + rangeDelta),
    );
  };
  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-line/70 bg-[#10141f] shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="flex flex-col gap-3 border-b border-white/10 px-3 py-3 sm:px-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-start lg:gap-3">
          <div className="w-full min-w-0 lg:w-auto lg:min-w-[12rem]">
            <h2 className="text-sm font-semibold text-white">今日相对涨跌幅</h2>
            <p className="mt-1 text-xs text-slate-300">
              {tickers.join(", ")} · 基准为今天第一条本地缓存价
            </p>
          </div>
          <div className="-mx-1 flex w-[calc(100%+0.5rem)] max-w-none gap-1 overflow-x-auto rounded-md border border-white/10 bg-white/5 p-1 sm:mx-0 sm:w-full lg:w-auto lg:flex-wrap lg:overflow-visible">
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
                    "shrink-0 whitespace-nowrap rounded px-2 py-1 text-[11px] font-semibold transition-colors",
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
        <div className="flex w-full flex-wrap gap-2 text-[11px] font-medium lg:w-auto lg:justify-end">
          <div className="flex overflow-hidden rounded-md border border-white/10 bg-white/5 text-slate-200">
            <button
              type="button"
              aria-label="Zoom out chart"
              title="Zoom out"
              disabled={!hasData}
              onClick={() => zoomFromCenter(1.25)}
              className="min-h-8 min-w-8 px-2 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              -
            </button>
            <button
              type="button"
              aria-label="Zoom in chart"
              title="Zoom in"
              disabled={!hasData}
              onClick={() => zoomFromCenter(0.8)}
              className="min-h-8 min-w-8 border-l border-white/10 px-2 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              aria-label="Reset chart zoom"
              title="Reset zoom"
              disabled={!hasData}
              onClick={resetZoom}
              className="min-h-8 min-w-9 border-l border-white/10 px-2 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              1x
            </button>
          </div>
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
          <div
            className={[
              "flex items-center justify-center px-6 text-center text-sm text-slate-300",
              compact ? "min-h-[14rem]" : "min-h-[17rem]",
            ].join(" ")}
          >
            {loading
              ? "正在读取本地行情缓存..."
              : "等待下一次行情刷新写入缓存后开始画线。"}
          </div>
        ) : (
          <svg
            ref={chartSvgRef}
            viewBox={compact ? "0 0 720 220" : "0 0 720 260"}
            role="img"
            aria-label="今日股票相对涨跌幅对比图"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={resetZoom}
            className="h-auto w-full touch-none overscroll-contain select-none cursor-grab active:cursor-grabbing"
          >
            <rect x="0" y="0" width="720" height={viewBoxHeight} fill="#10141f" />
            <defs>
              <clipPath id="stocks-performance-chart-plot">
                <rect
                  x={plot.left}
                  y={plot.top}
                  width={width}
                  height={height}
                />
              </clipPath>
            </defs>
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
              const labelPoint = [...item.points].reverse().find((point) => {
                const index = axisIndexForCapturedAt(point.capturedAt);
                return index >= visibleStartIndex && index <= visibleEndIndex;
              });
              const latestX = labelPoint ? toX(labelPoint.capturedAt) : plot.left;
              const latestY = labelPoint ? toY(labelPoint.changePct) : plot.bottom;
              const labelY =
                labelYByTicker[item.ticker] ??
                Math.max(plot.top + 10, Math.min(plot.bottom - 10, latestY));
              return (
                <g key={item.ticker}>
                  <path
                    d={linePath(points)}
                    fill="none"
                    stroke={color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                    clipPath="url(#stocks-performance-chart-plot)"
                  />
                  {labelPoint ? (
                    <>
                      <circle
                        cx={latestX}
                        cy={latestY}
                        r="2.4"
                        fill={color}
                        clipPath="url(#stocks-performance-chart-plot)"
                      />
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
                        {item.ticker} {formatSignedPercent(labelPoint.changePct)}
                      </text>
                    </>
                  ) : null}
                </g>
              );
            })}
            <text x={plot.left} y={axisLabelY} fill="#cbd5e1" fontSize="10">
              {formatAxisTime(
                new Date(
                  axisTimes[
                    Math.max(
                      0,
                      Math.min(axisTimes.length - 1, Math.floor(visibleStartIndex)),
                    )
                  ],
                ).toISOString(),
                hasMultipleMarketDates,
              )}
            </text>
            <text x={plot.right - 70} y={axisLabelY} fill="#cbd5e1" fontSize="10">
              {formatAxisTime(
                new Date(
                  axisTimes[
                    Math.max(
                      0,
                      Math.min(axisTimes.length - 1, Math.ceil(visibleEndIndex)),
                    )
                  ],
                ).toISOString(),
                hasMultipleMarketDates,
              )}
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
