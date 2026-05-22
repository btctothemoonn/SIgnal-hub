"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzeUsStockHoldings,
  getUsStockHoldingBriefCards,
  US_STOCK_HOLDING_SNAPSHOT,
  type UsStockHoldingBriefCard,
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

function formatPreciseUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
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

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatPercent(value)}`;
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

function PositionBriefCell({
  label,
  value,
  tone = "text-foreground",
  valueClassName = "truncate font-mono text-xl font-bold leading-tight sm:text-2xl",
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 sm:px-5">
      <div className="text-sm font-medium leading-tight text-muted">{label}</div>
      <div className={`mt-1 min-w-0 ${valueClassName} ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function positionLogoTone(symbol: string) {
  const tones: Record<string, string> = {
    ARM: "from-cyan-400/85 to-sky-800/80 text-white",
    DRAM: "from-emerald-400/80 to-teal-900/80 text-white",
    LITE: "from-blue-400/80 to-slate-900/85 text-white",
    MU: "from-violet-400/80 to-purple-950/85 text-white",
    NOK: "from-sky-400/80 to-blue-950/85 text-white",
    PENG: "from-amber-300/85 to-stone-900/85 text-stone-950",
    PLTR: "from-zinc-300/85 to-zinc-950/85 text-white",
    RDDT: "from-orange-300/85 to-red-900/85 text-white",
    SNDK: "from-red-300/85 to-rose-950/85 text-white",
    TE: "from-lime-300/85 to-emerald-950/85 text-emerald-950",
  };
  return tones[symbol] ?? "from-slate-300/80 to-slate-950/85 text-white";
}

function PositionLogo({ card }: { card: UsStockHoldingBriefCard }) {
  const label = card.kind === "option" ? "PUT" : card.symbol.slice(0, 4);
  return (
    <div
      className={[
        "flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10",
        positionLogoTone(card.symbol),
      ].join(" ")}
      aria-hidden="true"
    >
      <span className="text-lg font-black leading-none tracking-normal">
        {label.toLowerCase()}
      </span>
    </div>
  );
}

function PositionBriefPnl({ card }: { card: UsStockHoldingBriefCard }) {
  return (
    <span className="inline-flex max-w-full flex-col gap-1 overflow-hidden whitespace-nowrap">
      <span className="truncate">{formatSignedUsd(card.unrealizedPnl)}</span>
      <span className="shrink-0 text-base leading-none opacity-90">
        {formatSignedPercent(card.unrealizedPnlPercent)}
      </span>
    </span>
  );
}

function PositionBriefCards({ snapshot }: { snapshot: DisplaySnapshot }) {
  const cards = getUsStockHoldingBriefCards(snapshot);

  if (cards.length === 0) {
    return (
      <section className="flex min-h-[10rem] items-center justify-center rounded-lg border border-dashed border-line/80 bg-panel-strong p-4 text-sm text-muted">
        暂无美股持仓速览
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="text-sm font-semibold text-foreground">持仓明细</h3>
        <span className="text-xs font-semibold text-muted">{cards.length} 条</span>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {cards.map((card) => (
          <PositionBriefCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

function PositionBriefCard({ card }: { card: UsStockHoldingBriefCard }) {
  const name = card.optionLabel ?? card.name;
  const kindLabel = card.kind === "option" ? "期权" : card.theme;

  return (
    <article className="rounded-xl border border-white/10 bg-[radial-gradient(circle_at_8%_20%,rgba(74,112,141,0.20),transparent_32%),linear-gradient(135deg,rgba(14,21,31,0.94),rgba(10,15,23,0.98))] px-5 py-5 shadow-[0_28px_70px_-46px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.03]">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,18rem)_minmax(36rem,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <PositionLogo card={card} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <h4 className="truncate text-3xl font-black leading-none text-foreground">
                {card.symbol}
              </h4>
              <span className="shrink-0 rounded-full border border-success/20 bg-success-soft px-3 py-1 text-xs font-bold text-success">
                {kindLabel}
              </span>
            </div>
            <div className="mt-3 text-base font-medium leading-snug text-muted">
              {name}
            </div>
          </div>
        </div>

        <div className="order-3 grid min-w-0 grid-cols-3 gap-y-3 divide-line/70 sm:grid-cols-5 sm:divide-x xl:order-none">
          <PositionBriefCell
            label="数量"
            value={formatNumber(card.quantity, { maximumFractionDigits: 6 })}
            valueClassName="truncate font-mono text-xl font-black leading-tight sm:text-2xl"
          />
          <PositionBriefCell
            label="占比"
            value={formatPercent(card.weightPercent)}
            valueClassName="truncate font-mono text-xl font-black leading-tight sm:text-2xl"
          />
          <PositionBriefCell
            label="成本价"
            value={formatPreciseUsd(card.costBasis)}
            valueClassName="truncate font-mono text-xl font-black leading-tight sm:text-2xl"
          />
          <PositionBriefCell
            label="市价"
            value={formatPreciseUsd(card.currentPrice)}
            valueClassName="truncate font-mono text-xl font-black leading-tight sm:text-2xl"
          />
          <PositionBriefCell
            label="盈亏"
            value={<PositionBriefPnl card={card} />}
            tone={pnlTone(card.unrealizedPnl)}
            valueClassName="font-mono text-xl font-black leading-tight sm:text-2xl"
          />
        </div>

        <div className="order-2 shrink-0 text-right font-mono text-2xl font-black leading-none text-foreground sm:text-3xl xl:order-none xl:min-w-[11rem]">
          {formatUsd(card.marketValue)}
        </div>
      </div>
    </article>
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
    <section className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_8%_0%,rgba(60,92,130,0.22),transparent_30%),linear-gradient(180deg,rgba(8,13,22,0.98),rgba(7,11,17,0.98))] p-5 shadow-[0_32px_90px_-55px_rgba(0,0,0,1)] sm:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-black leading-tight text-foreground">
            持仓状况
          </h2>
          <p className="mt-2 text-sm font-medium text-muted">
            实时跟踪您的持仓表现，数据每 60 秒更新一次
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{snapshot.accountLabel}</span>
            <span className="h-1 w-1 rounded-full bg-line" />
            <span>{visibleGap}</span>
            <span className="h-1 w-1 rounded-full bg-line" />
            <span>合计市值 {formatUsd(analysis.totalMarketValue)}</span>
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

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right text-sm font-semibold text-muted">
            <span className="mr-2 text-base" aria-hidden="true">
              ◷
            </span>
            最后更新：{formatTime(snapshot.updatedAt)}
          </div>
          <button
            type="button"
            onClick={() => void loadTiger({ force: true })}
            disabled={isBusy}
            className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-foreground shadow-sm transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="刷新 Tiger 持仓"
            title={isBusy ? "刷新中" : "刷新 Tiger"}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          Tiger 实时数据暂不可用：{error} 当前展示本地缓存或截图兜底。
        </div>
      ) : null}

      {isTiger ? (
        <div className="mt-5">
          <EquityCurve points={equityHistory} />
        </div>
      ) : null}

      <div className="mt-5">
        <PositionBriefCards snapshot={snapshot} />
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm font-semibold text-muted">
        注：以上数据仅供参考，投资有风险，入市需谨慎。
      </div>
    </section>
  );
}
