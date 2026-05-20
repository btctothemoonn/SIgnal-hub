"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeUsStockHoldings,
  getUsStockHoldingGroups,
  getUsStockThemeAllocation,
  US_STOCK_HOLDING_SNAPSHOT,
  type UsStockHoldingPosition,
  type UsStockHoldingSnapshot,
} from "@/lib/us-stock-holdings";
import type { TigerEquityPoint, TigerHoldingSnapshot } from "@/lib/tiger-holdings";

type DisplaySnapshot = UsStockHoldingSnapshot | TigerHoldingSnapshot;

type TigerHoldingResponse =
  | {
      success: true;
      snapshot: TigerHoldingSnapshot;
      equityHistory?: TigerEquityPoint[];
    }
  | { success: false; error: string; upstreamStatus?: number };

type LoadState = "idle" | "loading" | "refreshing" | "ready" | "error";

const TIGER_HOLDING_STORAGE_KEY = "signal-hub.tiger-holding-snapshot.v1";
const TIGER_EQUITY_HISTORY_STORAGE_KEY = "signal-hub.tiger-equity-history.v1";

function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatSignedUsd(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatUsd(value)}`;
}

function formatCompactUsd(value: number) {
  const prefix = value > 0 ? "+" : "";
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
    style: "currency",
    currency: "USD",
  }).format(Math.abs(value));
  return value < 0 ? `-${formatted}` : `${prefix}${formatted}`;
}

function formatPercent(value: number) {
  return `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
}

function formatTime(raw: string | null | undefined) {
  if (!raw) return "n/a";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function pnlTone(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function pnlBadgeClass(value: number) {
  if (value > 0) return "border-success/30 bg-success-soft text-success";
  if (value < 0) return "border-danger/30 bg-danger-soft text-danger";
  return "border-line bg-panel text-muted";
}

function isTigerSnapshot(snapshot: DisplaySnapshot): snapshot is TigerHoldingSnapshot {
  return "source" in snapshot && snapshot.source === "tiger";
}

function isTigerEquityPoint(value: unknown): value is TigerEquityPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<TigerEquityPoint>;
  return (
    typeof point.at === "string" &&
    typeof point.netLiquidation === "number" &&
    Number.isFinite(point.netLiquidation) &&
    typeof point.holdingValue === "number" &&
    Number.isFinite(point.holdingValue) &&
    typeof point.cashBalance === "number" &&
    Number.isFinite(point.cashBalance) &&
    typeof point.pnl === "number" &&
    Number.isFinite(point.pnl)
  );
}

function isTigerHoldingSnapshot(value: unknown): value is TigerHoldingSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<TigerHoldingSnapshot>;
  return (
    snapshot.source === "tiger" &&
    typeof snapshot.updatedAt === "string" &&
    Array.isArray(snapshot.positions) &&
    typeof snapshot.reportedMarketValue === "number" &&
    typeof snapshot.reportedPnl === "number"
  );
}

function readStoredTigerSnapshot(): TigerHoldingSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(TIGER_HOLDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isTigerHoldingSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readStoredTigerEquityHistory(): TigerEquityPoint[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(TIGER_EQUITY_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((point): point is TigerEquityPoint =>
          isTigerEquityPoint(point),
        )
      : [];
  } catch {
    return [];
  }
}

function writeStoredTigerData(
  snapshot: TigerHoldingSnapshot,
  equityHistory: TigerEquityPoint[],
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      TIGER_HOLDING_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
    window.localStorage.setItem(
      TIGER_EQUITY_HISTORY_STORAGE_KEY,
      JSON.stringify(equityHistory),
    );
  } catch {
    // Browser cache is only a speed optimization.
  }
}

function RefreshIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18 9a7 7 0 0 0-11.8-2.2L4 9" />
      <path d="M6 15a7 7 0 0 0 11.8 2.2L20 15" />
    </svg>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="min-h-[7rem] rounded-lg border border-line/70 bg-panel-strong px-4 py-3 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="text-[11px] font-semibold uppercase tracking-normal text-muted">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold leading-tight ${tone}`}>
        {value}
      </div>
      <div className="mt-2 text-xs text-muted">{detail}</div>
    </div>
  );
}

function tileLayout(position: UsStockHoldingPosition, maxMarketValue: number) {
  const share = maxMarketValue > 0 ? position.marketValue / maxMarketValue : 0;
  if (share >= 0.75) return "md:col-span-4 xl:col-span-5";
  if (share >= 0.35) return "md:col-span-3 xl:col-span-4";
  if (share >= 0.18) return "md:col-span-2 xl:col-span-3";
  return "md:col-span-2 xl:col-span-2";
}

function PositionTreemap({ positions }: { positions: UsStockHoldingPosition[] }) {
  const sorted = [...positions].sort(
    (left, right) => right.marketValue - left.marketValue,
  );
  const maxMarketValue = sorted[0]?.marketValue ?? 0;
  const totalMarketValue = sorted.reduce(
    (sum, position) => sum + position.marketValue,
    0,
  );

  if (sorted.length === 0) {
    return (
      <section className="flex min-h-[14rem] items-center justify-center rounded-lg border border-dashed border-line/80 bg-panel-strong p-4 text-sm text-muted">
        暂无美股持仓
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">持仓热力图</h3>
          <p className="mt-1 text-xs text-muted">
            面积按市值，颜色按持仓盈亏
          </p>
        </div>
        <span className="rounded-md border border-line/70 bg-background/40 px-2 py-1 text-xs font-semibold text-muted">
          {positions.length} 条
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-6 xl:grid-cols-12">
        {sorted.map((position) => {
          const weight =
            totalMarketValue > 0 ? (position.marketValue / totalMarketValue) * 100 : 0;
          return (
            <article
              key={position.id}
              className={[
                "min-h-[9rem] rounded-lg border px-3 py-3",
                position.unrealizedPnl >= 0
                  ? "border-success/25 bg-success-soft"
                  : "border-danger/25 bg-danger-soft",
                tileLayout(position, maxMarketValue),
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold text-foreground">
                    {position.symbol}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {position.name}
                  </div>
                </div>
                <span
                  className={[
                    "rounded-md border px-2 py-0.5 text-[11px] font-bold",
                    pnlBadgeClass(position.unrealizedPnl),
                  ].join(" ")}
                >
                  {formatSignedUsd(position.unrealizedPnl)}
                </span>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <div className="font-mono text-xl font-semibold text-foreground">
                    {formatUsd(position.marketValue)}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    权重 {formatPercent(weight)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted">
                  <div>{formatNumber(position.quantity)} 股/张</div>
                  <div className="mt-1">{position.theme}</div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EquityCurve({ points }: { points: TigerEquityPoint[] }) {
  const validPoints = useMemo(
    () =>
      points
        .filter((point) => isTigerEquityPoint(point))
        .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
        .slice(-240),
    [points],
  );
  if (validPoints.length === 0) return null;

  const width = 720;
  const height = 220;
  const padX = 34;
  const padY = 22;
  const chartWidth = width - padX * 2;
  const chartHeight = height - padY * 2;
  const values = validPoints.map((point) => point.netLiquidation);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(1, maxValue - minValue);
  const paddedMin = minValue - range * 0.12;
  const paddedMax = maxValue + range * 0.12;
  const paddedRange = Math.max(1, paddedMax - paddedMin);
  const xForIndex = (index: number) =>
    validPoints.length <= 1
      ? padX + chartWidth / 2
      : padX + (index / (validPoints.length - 1)) * chartWidth;
  const yForValue = (value: number) =>
    padY + ((paddedMax - value) / paddedRange) * chartHeight;
  const polyline = validPoints
    .map((point, index) => `${xForIndex(index)},${yForValue(point.netLiquidation)}`)
    .join(" ");
  const firstPoint = validPoints[0];
  const lastPoint = validPoints[validPoints.length - 1];
  const change = lastPoint.netLiquidation - firstPoint.netLiquidation;
  const changePercent =
    firstPoint.netLiquidation > 0 ? (change / firstPoint.netLiquidation) * 100 : 0;

  return (
    <section className="rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">账户权益曲线</h3>
          <p className="mt-1 text-xs text-muted">
            老虎账户快照 · {validPoints.length} 个点 · 更新 {formatTime(lastPoint.at)}
          </p>
        </div>
        <div className={`font-mono text-sm font-bold ${pnlTone(change)}`}>
          {formatSignedUsd(change)} · {formatPercent(changePercent)}
        </div>
      </div>
      <svg
        className="h-56 w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="老虎账户权益历史曲线"
        preserveAspectRatio="none"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = padY + ratio * chartHeight;
          const value = paddedMax - ratio * paddedRange;
          return (
            <g key={ratio}>
              <line
                x1={padX}
                y1={y}
                x2={width - padX}
                y2={y}
                stroke="var(--line)"
                strokeOpacity="0.7"
                strokeWidth="1"
                strokeDasharray={ratio === 0.5 ? "4 6" : undefined}
              />
              <text
                x={width - padX + 8}
                y={y + 4}
                fill="currentColor"
                className="text-[10px] font-semibold text-muted"
              >
                {formatCompactUsd(value).replace("+", "")}
              </text>
            </g>
          );
        })}
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--success)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {validPoints.map((point, index) => (
          <circle
            key={`${point.at}-${index}`}
            cx={xForIndex(index)}
            cy={yForValue(point.netLiquidation)}
            r={index === validPoints.length - 1 ? 4 : 2.5}
            fill="var(--success)"
          />
        ))}
        <text
          x={padX}
          y={height - 4}
          fill="currentColor"
          className="text-[10px] font-semibold text-muted"
        >
          {formatTime(firstPoint.at)}
        </text>
        <text
          x={width - padX}
          y={height - 4}
          textAnchor="end"
          fill="currentColor"
          className="text-[10px] font-semibold text-muted"
        >
          {formatTime(lastPoint.at)}
        </text>
      </svg>
    </section>
  );
}

function OptionRiskStrip({ positions }: { positions: UsStockHoldingPosition[] }) {
  const options = positions.filter((position) => position.kind === "option");
  if (options.length === 0) return null;

  const totalPnl = options.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const totalMarketValue = options.reduce(
    (sum, position) => sum + position.marketValue,
    0,
  );

  return (
    <section className="rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">期权风险</h3>
          <p className="mt-1 text-xs text-muted">
            期权单独展示，避免和股票仓位混在一起
          </p>
        </div>
        <span className={`font-mono text-sm font-bold ${pnlTone(totalPnl)}`}>
          {formatSignedUsd(totalPnl)}
        </span>
      </div>
      <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
        期权市值 {formatUsd(totalMarketValue)}，当前盈亏{" "}
        {formatSignedUsd(totalPnl)}。
      </div>
      <div className="mt-3 grid gap-2">
        {options.map((position) => (
          <div
            key={position.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-line/70 bg-background/35 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {position.symbol}
              </div>
              <div className="mt-1 text-xs text-muted">
                {position.option?.expiry} · 行权价 {position.option?.strike}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm font-bold text-foreground">
                {formatUsd(position.marketValue)}
              </div>
              <div
                className={`mt-1 font-mono text-xs font-bold ${pnlTone(
                  position.unrealizedPnl,
                )}`}
              >
                {formatSignedUsd(position.unrealizedPnl)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThemeAllocation({ positions }: { positions: UsStockHoldingPosition[] }) {
  const allocation = getUsStockThemeAllocation(positions);
  if (allocation.length === 0) return null;

  return (
    <section className="rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <h3 className="text-sm font-semibold text-foreground">主题暴露</h3>
      <div className="mt-3 space-y-2">
        {allocation.map((item) => (
          <div key={item.theme}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-foreground">{item.theme}</span>
              <span className={`font-mono font-semibold ${pnlTone(item.pnl)}`}>
                {formatUsd(item.marketValue)} · {formatSignedUsd(item.pnl)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line/60">
              <div
                className={item.pnl >= 0 ? "h-full bg-success" : "h-full bg-danger"}
                style={{ width: `${Math.max(4, item.weight)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HoldingDetailTable({ positions }: { positions: UsStockHoldingPosition[] }) {
  const groups = getUsStockHoldingGroups(positions);
  const rows = [...groups.equity, ...groups.option];

  return (
    <section className="rounded-lg border border-line/70 bg-panel-strong shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">持仓明细</h3>
          <p className="mt-1 text-xs text-muted">
            股票 {groups.equity.length} · 期权 {groups.option.length}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-left text-xs">
          <thead className="border-b border-line/70 text-[11px] uppercase tracking-normal text-muted">
            <tr>
              <th className="px-3 py-2.5 font-semibold">名称 / 代码</th>
              <th className="px-3 py-2.5 font-semibold">类型</th>
              <th className="px-3 py-2.5 text-right font-semibold">持仓</th>
              <th className="px-3 py-2.5 text-right font-semibold">市值</th>
              <th className="px-3 py-2.5 text-right font-semibold">当前价</th>
              <th className="px-3 py-2.5 text-right font-semibold">成本</th>
              <th className="px-3 py-2.5 text-right font-semibold">盈亏</th>
              <th className="px-3 py-2.5 font-semibold">主题</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => (
              <tr
                key={position.id}
                className={[
                  "border-b border-line/50 last:border-0 hover:bg-panel/70",
                  position.unrealizedPnl >= 0
                    ? "shadow-[inset_3px_0_0_var(--success)]"
                    : "shadow-[inset_3px_0_0_var(--danger)]",
                ].join(" ")}
              >
                <td className="px-3 py-3">
                  <div className="font-semibold text-foreground">{position.name}</div>
                  <div className="mt-1 font-mono text-xs text-muted">
                    {position.market} · {position.symbol}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-md border border-line/70 bg-background/35 px-2 py-1 text-[11px] font-semibold text-muted">
                    {position.kind === "option" ? "期权" : "股票"}
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-foreground">
                  {formatNumber(position.quantity)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-semibold text-foreground">
                  {formatUsd(position.marketValue)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-muted">
                  {formatUsd(position.currentPrice)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-muted">
                  {formatUsd(position.costBasis)}
                </td>
                <td
                  className={`px-3 py-3 text-right font-mono font-bold ${pnlTone(
                    position.unrealizedPnl,
                  )}`}
                >
                  {formatSignedUsd(position.unrealizedPnl)}
                </td>
                <td className="px-3 py-3">
                  <div className="font-semibold text-foreground">{position.theme}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {position.tags.slice(0, 3).map((tag) => (
                      <span
                        key={`${position.id}-${tag}`}
                        className="rounded bg-background/50 px-1.5 py-0.5 text-[10px] font-semibold text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function USStockHoldingPanel() {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot>(() => {
    return readStoredTigerSnapshot() ?? US_STOCK_HOLDING_SNAPSHOT;
  });
  const [equityHistory, setEquityHistory] = useState<TigerEquityPoint[]>(() =>
    readStoredTigerEquityHistory(),
  );
  const [state, setState] = useState<LoadState>(() =>
    readStoredTigerSnapshot() ? "ready" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadTiger = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((current) => (current === "ready" ? "refreshing" : "loading"));
    setError(null);

    try {
      const response = await fetch(
        `/api/holdings/tiger${force ? "?refresh=1" : ""}`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as TigerHoldingResponse;
      if (!payload.success) {
        throw new Error(payload.error || "Tiger 持仓数据刷新失败。");
      }

      const history = payload.equityHistory ?? [];
      setSnapshot(payload.snapshot);
      setEquityHistory(history);
      writeStoredTigerData(payload.snapshot, history);
      setState("ready");
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Tiger 持仓数据刷新失败。",
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    void loadTiger();
    return () => abortRef.current?.abort();
  }, [loadTiger]);

  const analysis = analyzeUsStockHoldings(snapshot.positions, snapshot);
  const isTiger = isTigerSnapshot(snapshot);
  const isBusy = state === "loading" || state === "refreshing";
  const visibleGap =
    snapshot.reportedPositionCount - snapshot.positions.length > 0
      ? `${snapshot.reportedPositionCount - snapshot.positions.length} 条未展示`
      : "持仓已完整展示";
  const sourceLabel = isTiger ? "Tiger 实时" : "截图兜底";
  const statusTone =
    state === "error"
      ? "border-warning/30 bg-warning-soft text-warning"
      : isTiger
        ? "border-success/30 bg-success-soft text-success"
        : "border-line bg-panel text-muted";

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-normal text-info">
              US Portfolio
            </div>
            <h2 className="mt-1 text-2xl font-semibold leading-tight text-foreground">
              美股持仓看板
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{snapshot.accountLabel}</span>
              <span className="h-1 w-1 rounded-full bg-line" />
              <span>更新 {formatTime(snapshot.updatedAt)}</span>
              <span
                className={[
                  "rounded-md border px-2 py-0.5 font-semibold",
                  statusTone,
                ].join(" ")}
              >
                {sourceLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadTiger({ force: true })}
            disabled={isBusy}
            className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-lg border border-line/70 bg-panel px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-panel-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshIcon />
            {isBusy ? "刷新中" : "刷新 Tiger"}
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
            Tiger 实时数据暂不可用：{error} 当前展示本地缓存或截图兜底。
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-line/70 bg-background/35 px-3 py-2 text-xs text-muted">
          {visibleGap}；账户显示市值 {formatUsd(snapshot.reportedMarketValue)}，
          当前合计市值 {formatUsd(analysis.totalMarketValue)}。
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryMetric
          label="账户净值"
          value={
            isTiger && snapshot.netLiquidation > 0
              ? formatUsd(snapshot.netLiquidation)
              : formatUsd(snapshot.reportedMarketValue)
          }
          detail={
            isTiger
              ? `现金 ${formatUsd(snapshot.cashValue)}`
              : `账户显示 ${snapshot.reportedPositionCount} 条`
          }
        />
        <SummaryMetric
          label="持仓市值"
          value={formatUsd(snapshot.reportedMarketValue)}
          detail={`录入 ${snapshot.positions.length} 条`}
        />
        <SummaryMetric
          label="持仓盈亏"
          value={formatSignedUsd(snapshot.reportedPnl)}
          detail={formatPercent(analysis.totalPnlPercent)}
          tone={pnlTone(snapshot.reportedPnl)}
        />
        <SummaryMetric
          label="胜率"
          value={`${analysis.winningCount}/${snapshot.positions.length}`}
          detail={`${analysis.losingCount} 条浮亏`}
        />
        <SummaryMetric
          label="最大风险"
          value={analysis.largestLoss?.symbol ?? "n/a"}
          detail={
            analysis.largestLoss
              ? formatSignedUsd(analysis.largestLoss.unrealizedPnl)
              : "无亏损仓位"
          }
          tone={
            analysis.largestLoss
              ? pnlTone(analysis.largestLoss.unrealizedPnl)
              : undefined
          }
        />
      </div>

      {isTiger ? <EquityCurve points={equityHistory} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <PositionTreemap positions={snapshot.positions} />
        <div className="space-y-4">
          <OptionRiskStrip positions={snapshot.positions} />
          <ThemeAllocation positions={snapshot.positions} />
        </div>
      </div>

      <HoldingDetailTable positions={snapshot.positions} />
    </div>
  );
}
