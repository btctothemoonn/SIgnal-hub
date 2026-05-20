"use client";

import {
  analyzeUsStockHoldings,
  getUsStockHoldingGroups,
  getUsStockThemeAllocation,
  US_STOCK_HOLDING_SNAPSHOT,
  type UsStockHoldingPosition,
} from "@/lib/us-stock-holdings";

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

function formatPercent(value: number) {
  return `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
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

function formatTime(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
                  <div>{position.quantity} 股/张</div>
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

function OptionRiskStrip({ positions }: { positions: UsStockHoldingPosition[] }) {
  const options = positions.filter((position) => position.kind === "option");
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
          <p className="mt-1 text-xs text-muted">PLTR PUT 独立显示，避免和股票仓位混在一起</p>
        </div>
        <span className={`font-mono text-sm font-bold ${pnlTone(totalPnl)}`}>
          {formatSignedUsd(totalPnl)}
        </span>
      </div>
      <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
        期权市值 {formatUsd(totalMarketValue)}，当前亏损占总亏损约{" "}
        {formatPercent(Math.abs(totalPnl) / 1762.85 * 100)}。
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
              <div className={`mt-1 font-mono text-xs font-bold ${pnlTone(position.unrealizedPnl)}`}>
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
                  {formatNumber(position.quantity, { maximumFractionDigits: 0 })}
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
                <td className={`px-3 py-3 text-right font-mono font-bold ${pnlTone(position.unrealizedPnl)}`}>
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
  const snapshot = US_STOCK_HOLDING_SNAPSHOT;
  const analysis = analyzeUsStockHoldings(snapshot.positions, snapshot);
  const visibleGap =
    snapshot.reportedPositionCount - snapshot.positions.length > 0
      ? `${snapshot.reportedPositionCount - snapshot.positions.length} 条未在截图中完整露出`
      : "截图持仓已完整录入";

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
              <span>截图快照 {formatTime(snapshot.updatedAt)}</span>
              <span className="rounded-md border border-warning/30 bg-warning-soft px-2 py-0.5 font-semibold text-warning">
                手动录入
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
                账户显示
              </div>
              <div className="font-mono text-sm font-bold text-foreground">
                {formatUsd(snapshot.reportedMarketValue)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
                录入合计
              </div>
              <div className="font-mono text-sm font-bold text-foreground">
                {formatUsd(analysis.totalMarketValue)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
                盈亏
              </div>
              <div className={`font-mono text-sm font-bold ${pnlTone(analysis.totalPnl)}`}>
                {formatSignedUsd(analysis.totalPnl)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-normal text-muted">
                可见/账户
              </div>
              <div className="font-mono text-sm font-bold text-foreground">
                {snapshot.positions.length}/{snapshot.reportedPositionCount}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-line/70 bg-background/35 px-3 py-2 text-xs text-muted">
          {visibleGap}；截图市值与录入合计相差 {formatUsd(analysis.reportedMarketValueDelta)}，
          总盈亏已和截图对齐。
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryMetric
          label="美股市值"
          value={formatUsd(snapshot.reportedMarketValue)}
          detail={`录入 ${snapshot.positions.length} 条，账户显示 ${snapshot.reportedPositionCount} 条`}
        />
        <SummaryMetric
          label="持仓盈亏"
          value={formatSignedUsd(analysis.totalPnl)}
          detail={formatPercent(analysis.totalPnlPercent)}
          tone={pnlTone(analysis.totalPnl)}
        />
        <SummaryMetric
          label="胜率"
          value={`${analysis.winningCount}/${snapshot.positions.length}`}
          detail={`${analysis.losingCount} 条浮亏`}
        />
        <SummaryMetric
          label="最大仓位"
          value={analysis.topPosition?.symbol ?? "n/a"}
          detail={
            analysis.topPosition
              ? `${formatUsd(analysis.topPosition.marketValue)} · 前三 ${formatPercent(analysis.topThreeWeight)}`
              : "无持仓"
          }
        />
        <SummaryMetric
          label="最大风险"
          value={analysis.largestLoss?.symbol ?? "n/a"}
          detail={
            analysis.largestLoss
              ? formatSignedUsd(analysis.largestLoss.unrealizedPnl)
              : "无亏损"
          }
          tone={analysis.largestLoss ? pnlTone(analysis.largestLoss.unrealizedPnl) : undefined}
        />
      </div>

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
