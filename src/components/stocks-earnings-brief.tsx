import {
  areStocksEarningsValuesComparable,
  type StocksEarningsComparison,
  type StocksEarningsProvider,
  type StocksEarningsValueProvenance,
} from "../lib/stocks-earnings-comparison.ts";
import type {
  StocksCalendarEarningsItem,
  StocksEarningsMissingField,
  StocksEarningsSourceRef,
} from "../lib/stocks-earnings-calendar.ts";
import type { StocksEarningsInsight } from "@/lib/stocks-earnings-insight";

const providerLabel: Record<StocksEarningsProvider, string> = {
  fmp: "FMP",
  finnhub: "Finnhub",
  eodhd: "EODHD",
  "alpha-vantage": "AV",
  yahoo: "Yahoo",
  "official-ir": "公司 IR",
  sec: "SEC",
  "earnings-labs": "Earnings Labs",
  chartmill: "ChartMill",
  "minimax-web": "MiniMax Web",
};

const missingFieldLabel: Record<StocksEarningsMissingField, string> = {
  "revenue-estimate": "营收预计值",
  "revenue-actual": "营收公布值",
  "net-income-estimate": "净利润预计值",
  "net-income-actual": "净利润公布值",
};

type StocksEarningsBriefProps = {
  items: StocksCalendarEarningsItem[];
  insight: StocksEarningsInsight | null;
  calendarYear?: number;
  updatedAt?: string;
  source?: "live" | "mock";
};

function compactNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(absolute / 1_000_000_000).toFixed(2)}B`;
  }
  if (absolute >= 1_000_000) {
    return `${(absolute / 1_000_000).toFixed(2)}M`;
  }
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(2)}K`;
  return absolute.toFixed(2);
}

export function formatEarningsMoney(
  value: number | null,
  currency: string,
  missingLabel = "数据源暂未覆盖",
) {
  if (value === null) return missingLabel;
  const prefix = currency === "USD" ? "$" : `${currency} `;
  return `${value < 0 ? "-" : ""}${prefix}${compactNumber(value)}`;
}

function formatSignedPercent(value: number | null, missingLabel: string) {
  if (value === null) return missingLabel;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function valueTone(value: number | null) {
  if (value === null || value === 0) return "text-muted";
  return value > 0 ? "text-success" : "text-danger";
}

function reportTimingLabel(
  timing: StocksEarningsComparison["reportTiming"],
) {
  if (timing === "before-market") return "盘前";
  if (timing === "after-market") return "盘后";
  return "时间未知";
}

function displayTime(value?: string) {
  if (!value) return "时间未返回";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function provenanceMethodLabel(source?: StocksEarningsValueProvenance) {
  if (!source) return "来源未返回";
  if (source.method === "eps-times-diluted-shares") {
    return "推导 · EPS × 稀释股数";
  }
  return "直接";
}

function provenanceProviderLabel(source?: StocksEarningsValueProvenance) {
  return source ? providerLabel[source.provider] : "来源未返回";
}

function sourceAccountingBasis(source?: StocksEarningsValueProvenance) {
  return typeof source?.accountingBasis === "string"
    ? source.accountingBasis.trim()
    : "";
}

function MetricSource({
  source,
}: {
  source?: StocksEarningsValueProvenance;
}) {
  const label = `${provenanceProviderLabel(source)} · ${provenanceMethodLabel(source)}`;
  const basis = sourceAccountingBasis(source) || "口径未返回";
  return (
    <div className="mt-1 break-words text-[9px] leading-4 text-muted sm:text-[10px]">
      {source?.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground"
        >
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      <span className="block">{basis}</span>
    </div>
  );
}

function surpriseLabel(
  metric: StocksEarningsComparison["revenue"],
  upcoming: boolean,
) {
  if (upcoming) return "等待公布";
  if (!metric.estimateSource || !metric.actualSource) return "待数据";
  if (
    !areStocksEarningsValuesComparable(
      metric.actualSource,
      metric.estimateSource,
    )
  ) {
    return "口径不可比";
  }
  return formatSignedPercent(metric.surprisePct, "待数据");
}

function MetricCell({
  label,
  value,
  currency,
  source,
  missing,
}: {
  label: string;
  value: number | null;
  currency: string;
  source?: StocksEarningsValueProvenance;
  missing: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold text-muted sm:text-[10px]">
        {label}
      </p>
      <p className="mt-1 break-words font-mono text-xs font-semibold text-foreground sm:text-sm">
        {formatEarningsMoney(value, currency, missing)}
      </p>
      <MetricSource source={source} />
    </div>
  );
}

function MetricRow({
  label,
  metric,
  currency,
  upcoming,
}: {
  label: string;
  metric: StocksEarningsComparison["revenue"];
  currency: string;
  upcoming: boolean;
}) {
  const surprise = surpriseLabel(metric, upcoming);
  return (
    <div className="border-t border-line/60 px-3 py-3 sm:grid sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3 sm:px-4">
      <p className="mb-2 text-xs font-semibold text-foreground sm:mb-0 sm:pt-5 sm:text-sm">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <MetricCell
          label="预计值"
          value={metric.estimate}
          currency={currency}
          source={metric.estimateSource}
          missing="数据未覆盖"
        />
        <MetricCell
          label="公布值"
          value={metric.actual}
          currency={currency}
          source={metric.actualSource}
          missing={upcoming ? "等待公布" : "数据未覆盖"}
        />
        <div className="min-w-0">
          <p className="text-[9px] font-semibold text-muted sm:text-[10px]">
            较预期
          </p>
          <p
            className={`mt-1 break-words font-mono text-xs font-semibold sm:text-sm ${valueTone(
              metric.surprisePct,
            )}`}
          >
            {surprise}
          </p>
          <p className="mt-1 break-words text-[9px] leading-4 text-muted sm:text-[10px]">
            {surprise === "口径不可比"
              ? "预计与公布口径不同"
              : surprise === "待数据" || surprise === "等待公布"
                ? "暂不计算"
                : "按一致预期推导"}
          </p>
        </div>
      </div>
    </div>
  );
}

function statusPresentation(item: StocksCalendarEarningsItem) {
  if (item.status === "upcoming") {
    return { label: "即将发布", tone: "bg-warning-soft text-warning" };
  }
  if (item.status === "incomplete") {
    return { label: "数据不完整", tone: "bg-danger-soft text-danger" };
  }
  return { label: "已发布", tone: "bg-success-soft text-success" };
}

function SourceLink({
  source,
  prefix,
}: {
  source: StocksEarningsSourceRef | null;
  prefix: string;
}) {
  if (!source) return <span>{prefix}来源未返回</span>;
  const label = `${prefix}${providerLabel[source.provider]}`;
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" className="hover:text-foreground">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

function CompanyGuidance({ item }: { item: StocksCalendarEarningsItem }) {
  const guidance = item.companyGuidance;
  if (!guidance) return null;
  const range =
    guidance.revenueLow !== null && guidance.revenueHigh !== null
      ? `${formatEarningsMoney(guidance.revenueLow, guidance.currency)} 至 ${formatEarningsMoney(
          guidance.revenueHigh,
          guidance.currency,
        )}`
      : formatEarningsMoney(guidance.revenueMid, guidance.currency);
  return (
    <div className="border-t border-line/60 bg-info-soft/35 px-3 py-3 sm:px-4">
      <p className="text-[10px] font-semibold text-info">
        公司指引（非一致预期）
      </p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-foreground">营收 {range}</p>
        <SourceLink source={guidance.source} prefix="来源 " />
      </div>
    </div>
  );
}

function CompletenessWarning({ item }: { item: StocksCalendarEarningsItem }) {
  if (item.status !== "incomplete") return null;
  const missing = item.completeness.missing
    .map((field) => missingFieldLabel[field])
    .join("、");
  const attempted = item.completeness.attemptedProviders
    .map((provider) => providerLabel[provider])
    .join("、");
  return (
    <div className="border-t border-danger/25 bg-danger-soft/40 px-3 py-3 text-xs leading-5 text-danger sm:px-4">
      <p className="font-semibold">数据不完整：缺少 {missing || "必要财报字段"}</p>
      <p className="mt-1 text-muted">已尝试 {attempted || "现有公开数据源"}</p>
    </div>
  );
}

function QuarterPanel({ item }: { item: StocksCalendarEarningsItem }) {
  const status = statusPresentation(item);
  const upcoming = item.status === "upcoming";
  return (
    <article className="border-t border-line/70 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-mono text-sm font-semibold text-foreground">
              FY{item.fiscalYear} {item.quarter}
            </h4>
            <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted sm:text-xs">
            {item.reportDate ?? "报告日期未知"} · {reportTimingLabel(item.reportTiming)} · {item.currency}
          </p>
        </div>
        <p className="text-[10px] leading-5 text-muted sm:text-[11px]">
          <SourceLink source={item.reportDateSource} prefix="日期 " />
        </p>
      </div>
      <MetricRow
        label="营收"
        metric={item.revenue}
        currency={item.currency}
        upcoming={upcoming}
      />
      <MetricRow
        label="净利润"
        metric={item.netIncome}
        currency={item.currency}
        upcoming={upcoming}
      />
      <CompanyGuidance item={item} />
      <CompletenessWarning item={item} />
    </article>
  );
}

function InsightLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-3">
      <p className="text-[11px] font-semibold text-muted">{label}</p>
      <p className="text-sm leading-6 text-foreground">{value}</p>
    </div>
  );
}

export function StocksEarningsBrief({
  items,
  insight,
  calendarYear = new Date().getFullYear(),
  updatedAt,
  source,
}: StocksEarningsBriefProps) {
  const visibleItems = items.slice(0, 4);
  return (
    <section
      data-stocks-earnings-brief
      className="rounded-md border border-line/60 bg-panel-strong/80"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 px-3 py-3 sm:px-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{calendarYear} 财报</h3>
          <p className="mt-1 text-[11px] text-muted sm:text-xs">
            按发布日期排序 · 最多四个季度
          </p>
        </div>
        <p className="text-right text-[10px] leading-5 text-muted sm:text-[11px]">
          {source === "live" ? "缓存已更新" : "本地基线"} · {displayTime(updatedAt)}
        </p>
      </div>

      {visibleItems.length > 0 ? (
        <div>
          {visibleItems.map((item) => (
            <QuarterPanel
              key={`${item.ticker}-${item.fiscalYear}-${item.quarter}`}
              item={item}
            />
          ))}
        </div>
      ) : (
        <p className="px-3 py-5 text-sm text-muted sm:px-4">
          {calendarYear} 年暂无可核验的财报数据。
        </p>
      )}

      <div className="space-y-3 border-t border-line/60 px-3 py-4 sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted">AI 业绩洞察</p>
          <span className="text-[10px] text-muted">
            {insight?.source === "ai" ? insight.model ?? "AI" : "规则回退"}
          </span>
        </div>
        <InsightLine
          label="核心结论"
          value={insight?.conclusion ?? "洞察尚未生成，财报数字仍可正常查看。"}
        />
        <InsightLine
          label="主要驱动"
          value={insight?.driver ?? "等待后台财报摘要缓存。"}
        />
        <InsightLine
          label="风险提示"
          value={insight?.risk ?? "一致预期缺失时不判断超预期或不及预期。"}
        />
      </div>
    </section>
  );
}
