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
  analyzeSpotAllocation,
  getHeatmapTileLayout,
} from "@/lib/holding-analytics";
import { formatUsdtPrice } from "@/lib/holding-display";
import type {
  BinanceFuturesPosition,
  BinanceHoldingSnapshot,
  BinanceSpotBalance,
} from "@/lib/binance-holdings";

type BinanceHoldingResponse =
  | { success: true; snapshot: BinanceHoldingSnapshot }
  | { success: false; error: string; upstreamStatus?: number };

type BinanceCredentialResponse =
  | { success: true }
  | { success: false; error: string };

type LoadState = "idle" | "loading" | "refreshing" | "ready" | "error";
type SaveState = "idle" | "saving";

const HOLDING_SNAPSHOT_STORAGE_KEY = "signal-hub.binance-holding-snapshot.v1";
const SPOT_PIE_COLORS = [
  "#2f7a61",
  "#3f6386",
  "#9b6a26",
  "#a64233",
  "#806a9a",
  "#4e7a75",
  "#b76b3d",
  "#9d5c8a",
];

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

function positionBias(position: BinanceFuturesPosition) {
  if (position.side === "LONG" && position.unrealizedPnl > 0) return "盈利多头";
  if (position.side === "SHORT" && position.unrealizedPnl > 0) return "盈利空头";
  if (position.side === "LONG") return "多头风险";
  if (position.side === "SHORT") return "空头风险";
  return "中性";
}

function marginTypeText(marginType: string) {
  const normalized = marginType.toLowerCase();
  if (normalized === "cross") return "全仓";
  if (normalized === "isolated") return "逐仓";
  return marginType;
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

function readBrowserCachedSnapshot(): BinanceHoldingSnapshot | null {
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

function MeterBar({
  label,
  leftLabel,
  leftValue,
  leftPercent,
  rightLabel,
  rightValue,
}: {
  label: string;
  leftLabel: string;
  leftValue: ReactNode;
  leftPercent: number;
  rightLabel: string;
  rightValue: ReactNode;
}) {
  const boundedLeft = Math.max(0, Math.min(100, leftPercent));
  const boundedRight = 100 - boundedLeft;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-normal text-muted">
        <span>{label}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="relative flex h-10 overflow-hidden rounded-md bg-line/60 shadow-[inset_0_0_0_1px_var(--line)]">
        <div
          className="bg-success"
          style={{ width: `${boundedLeft}%` }}
          aria-label={`${leftLabel} ${formatPercent(boundedLeft)}`}
        />
        <div
          className="bg-danger"
          style={{ width: `${boundedRight}%` }}
          aria-label={`${rightLabel} ${formatPercent(boundedRight)}`}
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between gap-3 px-3 text-xs font-bold leading-none text-white sm:text-sm">
          <span className="min-w-0 truncate text-left drop-shadow">
            {formatPercent(boundedLeft)} {leftLabel} {leftValue}
          </span>
          <span className="min-w-0 truncate text-right drop-shadow">
            {formatPercent(boundedRight)} {rightLabel} {rightValue}
          </span>
        </div>
      </div>
    </div>
  );
}

function FuturesHeatmap({
  positions,
  maxAbsNotional,
}: {
  positions: BinanceFuturesPosition[];
  maxAbsNotional: number;
}) {
  if (positions.length === 0) {
    return <EmptyState>暂无活跃合约持仓</EmptyState>;
  }

  return (
    <div className="grid min-h-[20rem] grid-flow-dense grid-cols-6 gap-1 overflow-hidden rounded-lg border border-line/70 bg-background/40 p-1 lg:grid-cols-8 xl:grid-cols-12">
      {positions.map((position) => {
        const absNotional = Math.abs(position.notional);
        const layout = getHeatmapTileLayout({
          absNotional,
          maxAbsNotional,
        });
        const positive = position.unrealizedPnl >= 0;
        const sideClass =
          position.side === "LONG"
            ? "border-success/25 bg-success/70"
            : "border-danger/25 bg-danger/80";
        const pnlClass = positive
          ? "bg-white/20 text-white"
          : "bg-black/25 text-white";

        return (
          <div
            key={position.symbol}
            className={[
              "min-h-24 min-w-36 rounded-md border px-3 py-3 shadow-sm",
              sideClass,
              "text-white",
            ].join(" ")}
            style={{
              gridColumn: `span ${layout.colSpan}`,
              gridRow: `span ${layout.rowSpan}`,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{position.symbol}</div>
                <div className="mt-1 truncate font-mono text-[11px] font-semibold text-white/75">
                  标记价 {formatUsdtPrice(position.markPrice)}
                </div>
              </div>
              <div className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold">
                {sideText(position.side)}
              </div>
            </div>
            <div
              className={[
                "mt-3 inline-flex rounded px-1.5 py-0.5 text-lg font-bold leading-none",
                positive ? "text-white" : "bg-white/90 text-danger shadow-sm",
              ].join(" ")}
            >
              {formatCompactUsd(position.unrealizedPnl)}
            </div>
            <div
              className={[
                "mt-2 inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold",
                pnlClass,
              ].join(" ")}
            >
              {positive ? "盈利" : "亏损"} / 未实现盈亏
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs font-semibold text-white/85">
              <span>{formatCompactUsd(absNotional).replace("+", "")}</span>
              <span>
                {formatNumber(position.leverage, { maximumFractionDigits: 0 })}x
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FuturesDashboard({ snapshot }: { snapshot: BinanceHoldingSnapshot }) {
  const summary = snapshot.summary;
  const analytics = analyzeFuturesPositions({
    positions: snapshot.futuresPositions,
    summary,
  });
  const accountModeLabel =
    snapshot.accountMode === "portfolioMargin"
      ? "统一账户 U本位合约"
      : "U本位合约";

  return (
    <section className="overflow-hidden rounded-lg border border-line/70 bg-panel-strong shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="flex flex-col gap-3 border-b border-line/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-normal text-muted">
            合约持仓分布
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold leading-tight text-foreground">
              {accountModeLabel}
            </h3>
            <span
              className={[
                "rounded-md border px-2 py-0.5 text-xs font-bold",
                analytics.biasLabel.includes("Bullish")
                  ? "border-success/30 bg-success-soft text-success"
                  : analytics.biasLabel.includes("Bearish")
                    ? "border-danger/30 bg-danger-soft text-danger"
                    : "border-line bg-panel-strong text-muted",
              ].join(" ")}
            >
              {biasLabelText(analytics.biasLabel)}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
              账户权益
            </div>
            <div className="font-mono text-sm font-bold text-foreground">
              {formatUsd(summary.futuresWalletBalance)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
              未实现盈亏
            </div>
            <div
              className={`font-mono text-sm font-bold ${pnlTone(
                summary.futuresUnrealizedPnl,
              )}`}
            >
              {formatSignedUsd(summary.futuresUnrealizedPnl)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
              名义总额
            </div>
            <div className="font-mono text-sm font-bold text-foreground">
              {formatUsd(summary.futuresGrossNotional)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
              持仓数
            </div>
            <div className="font-mono text-sm font-bold text-foreground">
              {summary.futuresPositionCount}
            </div>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(22rem,0.85fr)_minmax(32rem,1.15fr)]">
        <div className="space-y-5 border-b border-line/70 p-4 xl:border-b-0 xl:border-r">
          <MeterBar
            label="未实现盈亏"
            leftLabel="盈利"
            leftValue={formatCompactUsd(analytics.positivePnl).replace("+", "")}
            leftPercent={analytics.profitShare}
            rightLabel="亏损"
            rightValue={formatCompactUsd(-analytics.negativePnlAbs)}
          />
          <MeterBar
            label="名义金额"
            leftLabel="多头"
            leftValue={formatCompactUsd(summary.futuresLongNotional).replace("+", "")}
            leftPercent={analytics.longShare}
            rightLabel="空头"
            rightValue={formatCompactUsd(summary.futuresShortNotional).replace("+", "")}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <SummaryTile
              label="净敞口"
              value={formatSignedUsd(summary.futuresNetNotional)}
              detail={biasLabelText(analytics.biasLabel)}
              tone={biasTone(analytics.biasLabel)}
            />
            <SummaryTile
              label="净敞口杠杆"
              value={`${formatNumber(analytics.netExposureLeverage, {
                maximumFractionDigits: 2,
              })}x`}
              detail="净敞口 / 保证金总额"
            />
            <SummaryTile
              label="可用余额"
              value={formatUsd(summary.futuresAvailableBalance)}
              detail="账户余额"
            />
          </div>
        </div>
        <div className="p-4">
          <FuturesHeatmap
            positions={snapshot.futuresPositions}
            maxAbsNotional={analytics.maxAbsNotional}
          />
        </div>
      </div>
    </section>
  );
}

function FuturesTable({ positions }: { positions: BinanceFuturesPosition[] }) {
  if (positions.length === 0) {
    return <EmptyState>暂无合约持仓</EmptyState>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line/70 bg-panel-strong shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <table className="w-full min-w-[70rem] border-collapse text-left text-xs">
        <thead className="border-b border-line/70 bg-panel-strong text-[11px] uppercase tracking-normal text-muted">
          <tr>
            <th className="px-3 py-2.5 font-semibold">交易对</th>
            <th className="px-3 py-2.5 font-semibold">方向</th>
            <th className="px-3 py-2.5 text-right font-semibold">杠杆</th>
            <th className="px-3 py-2.5 text-right font-semibold">数量</th>
            <th className="px-3 py-2.5 text-right font-semibold">名义金额</th>
            <th className="px-3 py-2.5 text-right font-semibold">开仓价</th>
            <th className="px-3 py-2.5 text-right font-semibold">标记价</th>
            <th className="px-3 py-2.5 text-right font-semibold">强平价</th>
            <th className="px-3 py-2.5 text-right font-semibold">未实现盈亏</th>
            <th className="px-3 py-2.5 text-right font-semibold">倾向</th>
            <th className="px-3 py-2.5 text-right font-semibold">保证金模式</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr
              key={position.symbol}
              className={[
                "border-b border-line/50 last:border-0 hover:bg-panel-strong/70",
                position.unrealizedPnl >= 0
                  ? "shadow-[inset_3px_0_0_var(--success)]"
                  : "shadow-[inset_3px_0_0_var(--danger)]",
              ].join(" ")}
            >
              <td className="px-3 py-3 font-semibold text-foreground">
                {position.symbol}
              </td>
              <td className="px-3 py-3">
                <span
                  className={[
                    "inline-flex min-w-14 justify-center rounded-md border px-2 py-1 text-[11px] font-semibold",
                    position.side === "LONG"
                      ? "border-success/30 bg-success-soft text-success"
                      : "border-danger/30 bg-danger-soft text-danger",
                  ].join(" ")}
                >
                  {sideText(position.side)}
                </span>
              </td>
              <td className="px-3 py-3 text-right text-muted">
                {formatNumber(position.leverage, { maximumFractionDigits: 0 })}x
              </td>
              <td className="px-3 py-3 text-right font-mono text-foreground">
                {formatNumber(position.amount, { maximumFractionDigits: 6 })}
              </td>
              <td className="px-3 py-3 text-right font-mono text-foreground">
                {formatUsd(Math.abs(position.notional))}
              </td>
              <td className="px-3 py-3 text-right font-mono text-muted">
                {formatNumber(position.entryPrice)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-muted">
                {formatNumber(position.markPrice)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-muted">
                {position.liquidationPrice
                  ? formatNumber(position.liquidationPrice)
                  : "-"}
              </td>
              <td
                className={`px-3 py-3 text-right font-mono font-semibold ${pnlTone(
                  position.unrealizedPnl,
                )}`}
              >
                {formatSignedUsd(position.unrealizedPnl)}
              </td>
              <td className={`px-3 py-3 text-right font-semibold ${pnlTone(position.unrealizedPnl)}`}>
                {positionBias(position)}
              </td>
              <td className="px-3 py-3 text-right text-muted">
                {marginTypeText(position.marginType)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpotAllocationPanel({ balances }: { balances: BinanceSpotBalance[] }) {
  if (balances.length === 0) {
    return <EmptyState>暂无估值超过 500 USDT 的现货资产</EmptyState>;
  }

  const allocation = analyzeSpotAllocation(balances);
  const gradient = allocation.slices
    .reduce<{ cursor: number; stops: string[] }>(
      (state, slice, index) => {
        const start = state.cursor;
        const end = start + slice.share;
        const color = SPOT_PIE_COLORS[index % SPOT_PIE_COLORS.length];
        return {
          cursor: end,
          stops: [...state.stops, `${color} ${start}% ${end}%`],
        };
      },
      { cursor: 0, stops: [] },
    )
    .stops
    .join(", ");

  return (
    <div className="grid gap-4 rounded-lg border border-line/70 bg-panel-strong p-4 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)] lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex items-center justify-center">
        <div className="relative h-64 w-64 rounded-full border border-line/70 bg-line/40 p-3">
          <div
            className="h-full w-full rounded-full"
            style={{
              background: `conic-gradient(${gradient})`,
            }}
            aria-label="现货资产占比饼图"
          />
          <div className="absolute inset-16 flex flex-col items-center justify-center rounded-full border border-line/70 bg-panel-strong text-center shadow-[0_18px_36px_-30px_rgba(38,31,27,0.55)]">
            <div className="text-[11px] font-semibold uppercase tracking-normal text-muted">
              总估值
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-foreground">
              {formatUsd(allocation.totalUsdtValue)}
            </div>
            <div className="mt-1 text-xs text-muted">{balances.length} 个币种</div>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
          <thead className="border-b border-line/70 text-[11px] uppercase tracking-normal text-muted">
            <tr>
              <th className="px-2 py-2 font-semibold">币种</th>
              <th className="px-2 py-2 text-right font-semibold">估值</th>
              <th className="px-2 py-2 text-right font-semibold">占比</th>
              <th className="px-2 py-2 text-right font-semibold">可用</th>
              <th className="px-2 py-2 text-right font-semibold">冻结</th>
            </tr>
          </thead>
          <tbody>
            {allocation.slices.map((slice, index) => {
              const balance = balances.find((item) => item.asset === slice.asset);
              return (
                <tr
                  key={slice.asset}
                  className="border-b border-line/50 last:border-0 hover:bg-panel-strong/70"
                >
                  <td className="px-2 py-2.5 font-semibold text-foreground">
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          SPOT_PIE_COLORS[index % SPOT_PIE_COLORS.length],
                      }}
                    />
                    {slice.asset}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono font-semibold text-foreground">
                    {formatUsd(slice.usdtValue)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-muted">
                    {formatPercent(slice.share)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-muted">
                    {formatNumber(balance?.free ?? 0, { maximumFractionDigits: 8 })}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-muted">
                    {formatNumber(balance?.locked ?? 0, {
                      maximumFractionDigits: 8,
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HoldingPanel() {
  const [snapshot, setSnapshot] = useState<BinanceHoldingSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("idle");
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
    const cachedSnapshot = readBrowserCachedSnapshot();
    if (cachedSnapshot) {
      setSnapshot(cachedSnapshot);
      setState("ready");
    }
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

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
      <div className="flex flex-col gap-3 border-b border-line/70 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-normal text-info">
            Binance
          </div>
          <h2 className="mt-1 text-2xl font-semibold leading-tight text-foreground">
            持仓总览
          </h2>
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

      {snapshot ? <FuturesDashboard snapshot={snapshot} /> : null}

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

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            合约持仓明细
          </h3>
          <span className="text-xs text-muted">
            {snapshot?.futuresPositions.length ?? 0} 条
          </span>
        </div>
        <FuturesTable positions={snapshot?.futuresPositions ?? []} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            现货资产分布（估值 &gt; 500 USDT）
          </h3>
          <span className="text-xs text-muted">
            {snapshot?.spotBalances.length ?? 0} 个币种
          </span>
        </div>
        <SpotAllocationPanel balances={snapshot?.spotBalances ?? []} />
      </section>
    </div>
  );
}
