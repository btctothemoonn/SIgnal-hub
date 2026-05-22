"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  analyzeFuturesPositions,
} from "@/lib/holding-analytics";
import { USStockHoldingPanel } from "@/components/us-stock-holding-panel";
import type {
  BinanceFuturesEquityPoint,
  BinanceFuturesPosition,
  BinanceHoldingSnapshot,
  BinanceSpotBalance,
} from "@/lib/binance-holdings";

type BinanceHoldingResponse =
  | {
      success: true;
      snapshot: BinanceHoldingSnapshot;
      equityHistory?: BinanceFuturesEquityPoint[];
    }
  | { success: false; error: string; upstreamStatus?: number };

type BinanceCredentialResponse =
  | { success: true }
  | { success: false; error: string };

type LoadState = "idle" | "loading" | "refreshing" | "ready" | "error";
type SaveState = "idle" | "saving";
type HoldingView = "us-stocks" | "binance";

const HOLDING_SNAPSHOT_STORAGE_KEY = "signal-hub.binance-holding-snapshot.v1";

function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
    ...options,
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
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

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatPercent(value)}`;
}

function formatTime(raw: string | null) {
  if (!raw) return "n/a";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatChartTime(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
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

function biasTone(label: string) {
  if (label.includes("Bullish") || label.includes("看多")) return "text-success";
  if (label.includes("Bearish") || label.includes("看空")) return "text-danger";
  return "text-muted";
}

function biasLabelText(label: string) {
  const labels: Record<string, string> = {
    "Extremely Bullish": "极强看多",
    Bullish: "看多",
    "Slightly Bullish": "轻微看多",
    Neutral: "中性",
    "Slightly Bearish": "轻微看空",
    Bearish: "看空",
    "Extremely Bearish": "极强看空",
  };
  return labels[label] ?? label;
}

function sideText(side: BinanceFuturesPosition["side"]) {
  return side === "LONG" ? "多头" : "空头";
}

function marginTypeText(marginType: string) {
  const normalized = marginType.toLowerCase();
  if (normalized === "cross") return "全仓";
  if (normalized === "isolated") return "逐仓";
  return marginType;
}

function isEquityPoint(value: unknown): value is BinanceFuturesEquityPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<BinanceFuturesEquityPoint>;
  return (
    typeof point.at === "string" &&
    !Number.isNaN(new Date(point.at).getTime()) &&
    typeof point.walletBalance === "number" &&
    Number.isFinite(point.walletBalance) &&
    typeof point.unrealizedPnl === "number" &&
    Number.isFinite(point.unrealizedPnl) &&
    typeof point.marginBalance === "number" &&
    Number.isFinite(point.marginBalance) &&
    typeof point.availableBalance === "number" &&
    Number.isFinite(point.availableBalance)
  );
}

function isBinanceHoldingSnapshot(value: unknown): value is BinanceHoldingSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<BinanceHoldingSnapshot>;
  return (
    snapshot.exchange === "binance" &&
    typeof snapshot.updatedAt === "string" &&
    Array.isArray(snapshot.spotBalances) &&
    Array.isArray(snapshot.futuresPositions) &&
    Boolean(snapshot.summary)
  );
}

function equityPointFromSnapshot(
  snapshot: BinanceHoldingSnapshot,
): BinanceFuturesEquityPoint {
  return {
    at: snapshot.updatedAt,
    walletBalance: snapshot.summary.futuresWalletBalance,
    unrealizedPnl: snapshot.summary.futuresUnrealizedPnl,
    marginBalance: snapshot.summary.futuresMarginBalance,
    availableBalance: snapshot.summary.futuresAvailableBalance,
  };
}

function equityHistoryWithCurrent({
  history,
  snapshot,
}: {
  history: BinanceFuturesEquityPoint[];
  snapshot: BinanceHoldingSnapshot;
}) {
  const points = new Map<string, BinanceFuturesEquityPoint>();
  for (const point of history) {
    if (isEquityPoint(point)) points.set(point.at, point);
  }
  const current = equityPointFromSnapshot(snapshot);
  if (isEquityPoint(current)) points.set(current.at, current);
  return [...points.values()]
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
    .slice(-240);
}

function readBrowserCachedSnapshot(): BinanceHoldingSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(HOLDING_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isBinanceHoldingSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeBrowserCachedSnapshot(snapshot: BinanceHoldingSnapshot) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      HOLDING_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  } catch {
    // Local cache is only a speed optimization.
  }
}

function clearBrowserCachedSnapshot() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(HOLDING_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Local cache is only a speed optimization.
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

function PlusIcon() {
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
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function CloseIcon() {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  tone = "text-foreground",
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
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

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-line/80 bg-panel/50 px-4 py-8 text-sm text-muted">
      {children}
    </div>
  );
}

function FuturesEquityCurve({
  snapshot,
  history,
}: {
  snapshot: BinanceHoldingSnapshot;
  history: BinanceFuturesEquityPoint[];
}) {
  const points = equityHistoryWithCurrent({ history, snapshot });
  const width = 720;
  const height = 240;
  const padX = 34;
  const padY = 24;
  const chartWidth = width - padX * 2;
  const chartHeight = height - padY * 2;
  const values = points.flatMap((point) => [
    point.marginBalance,
    point.walletBalance,
  ]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(1, maxValue - minValue);
  const paddedMin = minValue - range * 0.12;
  const paddedMax = maxValue + range * 0.12;
  const paddedRange = Math.max(1, paddedMax - paddedMin);
  const xForIndex = (index: number) =>
    points.length <= 1
      ? padX + chartWidth / 2
      : padX + (index / (points.length - 1)) * chartWidth;
  const yForValue = (value: number) =>
    padY + ((paddedMax - value) / paddedRange) * chartHeight;
  const equityPolyline = points
    .map((point, index) => `${xForIndex(index)},${yForValue(point.marginBalance)}`)
    .join(" ");
  const walletPolyline = points
    .map((point, index) => `${xForIndex(index)},${yForValue(point.walletBalance)}`)
    .join(" ");
  const firstPoint = points[0] ?? equityPointFromSnapshot(snapshot);
  const lastPoint = points[points.length - 1] ?? firstPoint;
  const equityChange = lastPoint.marginBalance - firstPoint.marginBalance;
  const equityChangePercent =
    firstPoint.marginBalance > 0
      ? (equityChange / firstPoint.marginBalance) * 100
      : 0;
  const hasTrend = points.length >= 2;

  return (
    <div className="border-b border-line/70 p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 rounded-lg border border-line/70 bg-background/35 p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-normal text-muted">
                合约账户权益曲线
              </div>
              <div className="mt-1 text-xs text-muted">
                本地快照 · {points.length} 个点 · 最近 {formatChartTime(lastPoint.at)}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] font-semibold text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success" />
                账户权益
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-info" />
                钱包余额
              </span>
            </div>
          </div>

          <svg
            className="h-64 w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="合约账户权益历史曲线"
            preserveAspectRatio="none"
          >
            <line
              x1={padX}
              y1={padY}
              x2={padX}
              y2={height - padY}
              stroke="var(--line)"
              strokeWidth="1"
            />
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
              points={walletPolyline}
              fill="none"
              stroke="var(--info)"
              strokeOpacity="0.7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={equityPolyline}
              fill="none"
              stroke="var(--success)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {points.map((point, index) => (
              <circle
                key={point.at}
                cx={xForIndex(index)}
                cy={yForValue(point.marginBalance)}
                r={index === points.length - 1 ? 4 : 2.5}
                fill="var(--success)"
              />
            ))}
            <text
              x={padX}
              y={height - 4}
              fill="currentColor"
              className="text-[10px] font-semibold text-muted"
            >
              {formatChartTime(firstPoint.at)}
            </text>
            <text
              x={width - padX}
              y={height - 4}
              textAnchor="end"
              fill="currentColor"
              className="text-[10px] font-semibold text-muted"
            >
              {formatChartTime(lastPoint.at)}
            </text>
          </svg>

          {!hasTrend ? (
            <div className="mt-2 rounded-md border border-line/60 bg-panel px-3 py-2 text-xs text-muted">
              已保存当前权益点；继续刷新后会形成完整曲线。
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <SummaryTile
            label="当前权益"
            value={formatUsd(lastPoint.marginBalance)}
            detail={`钱包 ${formatUsd(lastPoint.walletBalance)}`}
          />
          <SummaryTile
            label="区间变化"
            value={formatSignedUsd(equityChange)}
            detail={`${formatPercent(equityChangePercent)} · ${formatChartTime(firstPoint.at)} 起`}
            tone={pnlTone(equityChange)}
          />
          <SummaryTile
            label="未实现盈亏"
            value={formatSignedUsd(lastPoint.unrealizedPnl)}
            detail={`可用余额 ${formatUsd(lastPoint.availableBalance)}`}
            tone={pnlTone(lastPoint.unrealizedPnl)}
          />
        </div>
      </div>
    </div>
  );
}

function baseAssetFromSymbol(symbol: string) {
  return symbol.replace(/(USDT|USDC|BUSD|FDUSD|USD)$/i, "") || symbol;
}

function futuresPnlPercent(position: BinanceFuturesPosition) {
  const costBasis = Math.abs(position.amount * position.entryPrice);
  const fallbackBasis = Math.abs(position.notional);
  const basis = costBasis > 0 ? costBasis : fallbackBasis;
  return basis > 0 ? (position.unrealizedPnl / basis) * 100 : 0;
}

function spotSharePercent(balance: BinanceSpotBalance, totalUsdtValue: number) {
  const value = balance.usdtValue ?? 0;
  return totalUsdtValue > 0 ? (value / totalUsdtValue) * 100 : 0;
}

function assetLogoTone(asset: string) {
  const normalized = asset.toUpperCase();
  if (["BTC", "BNB", "SOL"].includes(normalized)) {
    return "border-warning/25 bg-warning-soft text-warning";
  }
  if (["ETH", "ARB", "OP", "LINK"].includes(normalized)) {
    return "border-info/25 bg-info-soft text-info";
  }
  if (["USDT", "USDC", "FDUSD", "BUSD"].includes(normalized)) {
    return "border-success/25 bg-success-soft text-success";
  }
  return "border-line bg-panel text-foreground";
}

function AssetLogo({ asset }: { asset: string }) {
  return (
    <div
      className={[
        "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border font-mono text-base font-black uppercase shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        assetLogoTone(asset),
      ].join(" ")}
    >
      {asset.slice(0, 4)}
    </div>
  );
}

function HoldingMetricCell({
  label,
  value,
  detail,
  tone = "text-foreground",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="min-w-0 border-line/70 sm:border-l sm:pl-5">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div
        className={[
          "mt-1 truncate font-mono text-xl font-black leading-tight tracking-normal",
          tone,
        ].join(" ")}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-1 truncate text-xs font-semibold text-muted">{detail}</div>
      ) : null}
    </div>
  );
}

function BinanceSummaryGrid({ snapshot }: { snapshot: BinanceHoldingSnapshot }) {
  const summary = snapshot.summary;
  const analytics = analyzeFuturesPositions({
    positions: snapshot.futuresPositions,
    summary,
  });
  const spotTotal = snapshot.spotBalances.reduce(
    (total, balance) => total + (balance.usdtValue ?? 0),
    0,
  );
  const pnlPercent =
    summary.futuresMarginBalance > 0
      ? (summary.futuresUnrealizedPnl / summary.futuresMarginBalance) * 100
      : 0;

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryTile
        label="合约权益"
        value={formatUsd(summary.futuresMarginBalance)}
        detail={`钱包 ${formatUsd(summary.futuresWalletBalance)}`}
      />
      <SummaryTile
        label="未实现盈亏"
        value={formatSignedUsd(summary.futuresUnrealizedPnl)}
        detail={`占权益 ${formatSignedPercent(pnlPercent)}`}
        tone={pnlTone(summary.futuresUnrealizedPnl)}
      />
      <SummaryTile
        label="合约名义"
        value={formatCompactUsd(summary.futuresGrossNotional).replace("+", "")}
        detail={`${summary.futuresPositionCount} 条持仓`}
      />
      <SummaryTile
        label="净敞口"
        value={formatSignedUsd(summary.futuresNetNotional)}
        detail={`${biasLabelText(analytics.biasLabel)} · ${formatNumber(
          analytics.netExposureLeverage,
          { maximumFractionDigits: 2 },
        )}x`}
        tone={biasTone(analytics.biasLabel)}
      />
      <SummaryTile
        label="现货估值"
        value={formatUsd(spotTotal)}
        detail={`${snapshot.summary.spotAssetCount} 个币种`}
      />
    </div>
  );
}

function FuturesPositionCards({
  positions,
}: {
  positions: BinanceFuturesPosition[];
}) {
  if (positions.length === 0) {
    return <EmptyState>暂无合约持仓</EmptyState>;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-black text-foreground">合约持仓</h3>
        <span className="rounded-md border border-line/70 bg-background px-2 py-1 text-xs font-semibold text-muted">
          {positions.length} 条
        </span>
      </div>
      <div className="grid gap-3">
        {positions.map((position) => {
          const asset = baseAssetFromSymbol(position.symbol);
          const absNotional = Math.abs(position.notional);
          const pnlPercent = futuresPnlPercent(position);
          const positive = position.unrealizedPnl >= 0;

          return (
            <article
              key={`${position.symbol}-${position.side}`}
              className="overflow-hidden rounded-xl border border-line/75 bg-background/55 p-4 shadow-[0_22px_70px_-55px_rgba(0,0,0,0.72)]"
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(15rem,1.1fr)_minmax(0,3.2fr)_minmax(11rem,0.9fr)] xl:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <AssetLogo asset={asset} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h4 className="truncate font-mono text-2xl font-black leading-tight text-foreground">
                        {asset}
                      </h4>
                      <span
                        className={[
                          "rounded-md border px-2 py-0.5 text-xs font-bold",
                          position.side === "LONG"
                            ? "border-success/30 bg-success-soft text-success"
                            : "border-danger/30 bg-danger-soft text-danger",
                        ].join(" ")}
                      >
                        {sideText(position.side)}
                      </span>
                      <span className="rounded-md border border-line/70 bg-panel px-2 py-0.5 text-xs font-bold text-muted">
                        {marginTypeText(position.marginType)}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs font-semibold text-muted">
                      {position.symbol}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  <HoldingMetricCell
                    label="数量"
                    value={formatNumber(Math.abs(position.amount), {
                      maximumFractionDigits: 6,
                    })}
                    detail={`${formatNumber(position.leverage, {
                      maximumFractionDigits: 0,
                    })}x 杠杆`}
                  />
                  <HoldingMetricCell
                    label="开仓价"
                    value={formatUsd(position.entryPrice)}
                    detail="成本"
                  />
                  <HoldingMetricCell
                    label="标记价"
                    value={formatUsd(position.markPrice)}
                    detail="当前"
                  />
                  <HoldingMetricCell
                    label="强平价"
                    value={
                      position.liquidationPrice > 0
                        ? formatUsd(position.liquidationPrice)
                        : "--"
                    }
                    detail="风险线"
                  />
                  <HoldingMetricCell
                    label="盈亏"
                    value={formatSignedUsd(position.unrealizedPnl)}
                    detail={formatSignedPercent(pnlPercent)}
                    tone={pnlTone(position.unrealizedPnl)}
                  />
                </div>

                <div className="xl:text-right">
                  <div className="text-xs font-semibold text-muted">名义金额</div>
                  <div className="mt-1 font-mono text-2xl font-black text-foreground">
                    {formatUsd(absNotional)}
                  </div>
                  <div
                    className={[
                      "mt-1 text-xs font-bold",
                      positive ? "text-success" : "text-danger",
                    ].join(" ")}
                  >
                    {positive ? "浮盈中" : "浮亏中"}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SpotBalanceCards({ balances }: { balances: BinanceSpotBalance[] }) {
  const valuedBalances = [...balances]
    .filter((balance) => (balance.usdtValue ?? 0) > 0)
    .sort(
      (left, right) =>
        (right.usdtValue ?? 0) - (left.usdtValue ?? 0) ||
        left.asset.localeCompare(right.asset),
    );
  const totalUsdtValue = valuedBalances.reduce(
    (total, balance) => total + (balance.usdtValue ?? 0),
    0,
  );

  if (valuedBalances.length === 0) {
    return <EmptyState>暂无估值超过 500 USDT 的现货资产</EmptyState>;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-black text-foreground">现货资产</h3>
        <span className="rounded-md border border-line/70 bg-background px-2 py-1 text-xs font-semibold text-muted">
          {valuedBalances.length} 个币种
        </span>
      </div>
      <div className="grid gap-3">
        {valuedBalances.map((balance) => {
          const value = balance.usdtValue ?? 0;
          const share = spotSharePercent(balance, totalUsdtValue);

          return (
            <article
              key={balance.asset}
              className="overflow-hidden rounded-xl border border-line/75 bg-background/55 p-4 shadow-[0_22px_70px_-55px_rgba(0,0,0,0.72)]"
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(13rem,1fr)_minmax(0,2.7fr)_minmax(10rem,0.8fr)] lg:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <AssetLogo asset={balance.asset} />
                  <div className="min-w-0">
                    <h4 className="truncate font-mono text-2xl font-black leading-tight text-foreground">
                      {balance.asset}
                    </h4>
                    <div className="mt-1 text-xs font-semibold text-muted">
                      Binance Spot
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  <HoldingMetricCell
                    label="总数量"
                    value={formatNumber(balance.total, { maximumFractionDigits: 8 })}
                  />
                  <HoldingMetricCell
                    label="可用"
                    value={formatNumber(balance.free, { maximumFractionDigits: 8 })}
                  />
                  <HoldingMetricCell
                    label="冻结"
                    value={formatNumber(balance.locked, { maximumFractionDigits: 8 })}
                  />
                  <HoldingMetricCell
                    label="价格"
                    value={balance.usdtPrice ? formatUsd(balance.usdtPrice) : "--"}
                  />
                  <HoldingMetricCell label="占比" value={formatPercent(share)} />
                </div>

                <div className="lg:text-right">
                  <div className="text-xs font-semibold text-muted">估值</div>
                  <div className="mt-1 font-mono text-2xl font-black text-foreground">
                    {formatUsd(value)}
                  </div>
                  <div className="mt-1 text-xs font-bold text-muted">
                    现货资产占比
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function HoldingPanel() {
  const [activeHoldingView, setActiveHoldingView] =
    useState<HoldingView>("us-stocks");
  const [snapshot, setSnapshot] = useState<BinanceHoldingSnapshot | null>(() =>
    readBrowserCachedSnapshot(),
  );
  const [equityHistory, setEquityHistory] = useState<BinanceFuturesEquityPoint[]>([]);
  const [state, setState] = useState<LoadState>(() =>
    readBrowserCachedSnapshot() ? "ready" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((current) => (current === "ready" ? "refreshing" : "loading"));
    setError(null);

    try {
      const response = await fetch(
        `/api/holdings/binance${force ? "?refresh=1" : ""}`,
        {
        cache: "no-store",
        signal: controller.signal,
        },
      );
      const payload = (await response.json()) as BinanceHoldingResponse;
      if (!payload.success) {
        throw new Error(payload.error || "持仓数据刷新失败。");
      }
      setSnapshot(payload.snapshot);
      setEquityHistory(payload.equityHistory ?? []);
      writeBrowserCachedSnapshot(payload.snapshot);
      setState("ready");
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(
        loadError instanceof Error ? loadError.message : "持仓数据刷新失败。",
      );
      setState("error");
    }
  }, []);

  const saveApiCredentials = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSaveState("saving");
      setSaveError(null);

      try {
        const response = await fetch("/api/holdings/binance", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ apiKey, apiSecret }),
        });
        const payload = (await response.json()) as BinanceCredentialResponse;
        if (!payload.success) {
          throw new Error(payload.error || "API 保存失败。");
        }
        setApiKey("");
        setApiSecret("");
        clearBrowserCachedSnapshot();
        setApiDialogOpen(false);
        await load({ force: true });
      } catch (saveErrorValue) {
        setSaveError(
          saveErrorValue instanceof Error
            ? saveErrorValue.message
            : "API 保存失败。",
        );
      } finally {
        setSaveState("idle");
      }
    },
    [apiKey, apiSecret, load],
  );

  useEffect(() => {
    if (activeHoldingView !== "binance") return;
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [activeHoldingView, load]);

  const isBusy = state === "loading" || state === "refreshing";
  const hasWarnings = Boolean(snapshot?.warnings.length);
  const statusTone =
    state === "error"
      ? "border-danger/30 bg-danger-soft text-danger"
      : hasWarnings
        ? "border-warning/30 bg-warning-soft text-warning"
        : "border-success/30 bg-success-soft text-success";
  const statusLabel =
    state === "error"
      ? "异常"
      : isBusy
        ? "同步中"
        : hasWarnings
          ? "部分数据"
          : "已同步";
  const accountModeLabel =
    snapshot?.accountMode === "portfolioMargin"
      ? "统一账户 U本位合约"
      : "U本位合约";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-line/70 bg-panel-strong p-3 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-normal text-muted">
            Holding
          </div>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            持仓账户
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-line/70 bg-background/45 p-1 sm:w-[22rem]">
          {[
            { id: "us-stocks" as const, label: "美股证券" },
            { id: "binance" as const, label: "Binance" },
          ].map((item) => {
            const selected = activeHoldingView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveHoldingView(item.id)}
                className={[
                  "h-9 rounded-md px-3 text-xs font-semibold transition-colors",
                  selected
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted hover:bg-panel hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeHoldingView === "us-stocks" ? <USStockHoldingPanel /> : null}

      {activeHoldingView === "binance" ? (
        <section className="overflow-hidden rounded-2xl border border-line/70 bg-panel-strong shadow-[0_26px_90px_-70px_rgba(0,0,0,0.8)]">
      <div className="flex flex-col gap-3 border-b border-line/70 px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-normal text-info">
            Binance
          </div>
          <h2 className="mt-1 text-2xl font-semibold leading-tight text-foreground">
            Binance 持仓状况
          </h2>
          <p className="mt-1 text-sm font-semibold text-muted">
            实时跟踪 Binance 现货与合约表现，数据每 60 秒更新一次
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>现货 + {accountModeLabel}</span>
            <span className="h-1 w-1 rounded-full bg-line" />
            <span>更新 {formatTime(snapshot?.updatedAt ?? null)}</span>
            <span
              className={[
                "inline-flex rounded-md border px-2 py-0.5 font-semibold",
                statusTone,
              ].join(" ")}
            >
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setApiDialogOpen(true);
            }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-info/30 bg-info-soft px-3 text-xs font-semibold text-info shadow-sm transition-colors hover:border-info/50 hover:bg-info-soft/80"
          >
            <PlusIcon />
            添加 API
          </button>
          <button
            type="button"
            onClick={() => void load({ force: true })}
            disabled={isBusy}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line/70 bg-panel px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-panel-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshIcon />
            {isBusy ? "刷新中" : "刷新"}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {snapshot?.warnings.length ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <div className="font-semibold">部分数据</div>
          <div className="mt-1 space-y-1 text-xs leading-5">
            {snapshot.warnings.map((warning) => (
              <div
                key={`${warning.scope}-${warning.endpoint}-${warning.status ?? "network"}`}
              >
                {warning.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {state === "loading" && !snapshot ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {["a", "b", "c", "d", "e"].map((key) => (
            <div
              key={key}
              className="h-28 animate-pulse rounded-lg border border-line/70 bg-panel"
            />
          ))}
        </div>
      ) : null}

      {snapshot ? (
        <div className="space-y-4">
          <BinanceSummaryGrid snapshot={snapshot} />
          <FuturesEquityCurve snapshot={snapshot} history={equityHistory} />
          <FuturesPositionCards positions={snapshot.futuresPositions} />
          <SpotBalanceCards balances={snapshot.spotBalances} />
          <div className="rounded-xl border border-line/70 bg-background/45 px-4 py-3 text-xs font-semibold leading-5 text-muted">
            注：以上数据仅用于持仓观察；币安接口可能存在延迟，交易和风控以交易所账户为准。
          </div>
        </div>
      ) : null}

      {apiDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/72 px-3 backdrop-blur-sm">
          <form
            onSubmit={saveApiCredentials}
            className="w-full max-w-lg rounded-lg border border-line/80 bg-panel-strong shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-normal text-info">
                  Binance
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  添加 API
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setApiDialogOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line/70 bg-panel text-muted transition-colors hover:bg-panel-strong hover:text-foreground"
                aria-label="关闭"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <label className="block space-y-1.5 text-xs font-semibold text-muted">
                <span>API Key（密钥）</span>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="selectable-text h-10 w-full rounded-lg border border-line/80 bg-background px-3 font-mono text-sm font-normal text-foreground outline-none transition-colors focus:border-info/60"
                  placeholder="输入 Binance API Key"
                />
              </label>
              <label className="block space-y-1.5 text-xs font-semibold text-muted">
                <span>API Secret（私钥）</span>
                <input
                  value={apiSecret}
                  onChange={(event) => setApiSecret(event.target.value)}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="selectable-text h-10 w-full rounded-lg border border-line/80 bg-background px-3 font-mono text-sm font-normal text-foreground outline-none transition-colors focus:border-info/60"
                  placeholder="输入 Binance API Secret"
                />
              </label>

              <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                建议只开启读取权限，不开启交易和提现。密钥会保存到本机
                .signal-hub/binance-api.json。
              </div>

              {saveError ? (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                  {saveError}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line/70 px-4 py-3">
              <button
                type="button"
                onClick={() => setApiDialogOpen(false)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-line/70 bg-panel px-3 text-xs font-semibold text-muted transition-colors hover:bg-panel-strong hover:text-foreground"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saveState === "saving"}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-info/30 bg-info px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-info/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saveState === "saving" ? "保存中..." : "保存并刷新"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      </div>
        </section>
      ) : null}
    </div>
  );
}
