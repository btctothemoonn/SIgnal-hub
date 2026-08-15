import type {
  StocksEarningsComparison,
  StocksEarningsValueProvenance,
} from "@/lib/stocks-earnings-comparison";
import type { StocksEarningsInsight } from "@/lib/stocks-earnings-insight";

const providerLabel: Record<
  StocksEarningsValueProvenance["provider"],
  string
> = {
  fmp: "FMP",
  finnhub: "Finnhub",
  eodhd: "EODHD",
  "alpha-vantage": "AV",
  yahoo: "Yahoo",
};

type FinancialMissingState = "waiting" | "uncovered";

type StocksEarningsBriefProps = {
  comparison: StocksEarningsComparison | null;
  insight: StocksEarningsInsight | null;
  updatedAt?: string;
  source?: "live" | "mock";
};

function compactNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(absolute / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(absolute / 1_000_000).toFixed(2)}M`;
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

function formatSignedMoney(
  value: number | null,
  currency: string,
  missingLabel: string,
) {
  if (value === null) return missingLabel;
  return `${value > 0 ? "+" : ""}${formatEarningsMoney(value, currency, missingLabel)}`;
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

function missingLabel(state: FinancialMissingState) {
  return state === "waiting" ? "等待公布" : "数据源暂未覆盖";
}

function isFutureOrUnpublished(comparison: StocksEarningsComparison) {
  const reportDate = comparison.reportDate
    ? Date.parse(`${comparison.reportDate}T23:59:59Z`)
    : NaN;
  if (Number.isFinite(reportDate)) return reportDate > Date.now();
  const fiscalDate = Date.parse(`${comparison.fiscalDateEnding}T23:59:59Z`);
  return Number.isFinite(fiscalDate) && fiscalDate > Date.now();
}

function provenanceMethodLabel(source?: StocksEarningsValueProvenance) {
  if (!source) return "来源未返回";
  if (source?.method === "eps-times-diluted-shares") {
    return "EPS 推算 · 推导";
  }
  return source?.method === "direct" ? "直接" : "推导";
}

function provenanceProviderLabel(
  source: StocksEarningsValueProvenance | undefined,
  comparison: StocksEarningsComparison,
) {
  return providerLabel[source?.provider ?? comparison.provider];
}

function accountingBasisLabel(
  source: StocksEarningsValueProvenance | undefined,
  comparison: StocksEarningsComparison,
) {
  return source?.accountingBasis || comparison.accountingBasis;
}

function derivedProviderLabel(
  metric: StocksEarningsComparison["revenue"],
  comparison: StocksEarningsComparison,
) {
  const providers = [
    provenanceProviderLabel(metric.estimateSource, comparison),
    provenanceProviderLabel(metric.actualSource, comparison),
  ].filter((provider, index, values) => values.indexOf(provider) === index);
  return `推导 · ${providers.join("/")}`;
}

function MetricValue({
  value,
  yoy,
  currency,
  source,
  comparison,
  missingState,
}: {
  value: number | null;
  yoy: number | null;
  currency: string;
  source?: StocksEarningsValueProvenance;
  comparison: StocksEarningsComparison;
  missingState: FinancialMissingState;
}) {
  const missing = missingLabel(missingState);

  return (
    <div className="min-w-0 text-right">
      <p className="break-words font-mono text-xs font-semibold text-foreground sm:text-sm">
        {formatEarningsMoney(value, currency, missing)}
      </p>
      <p
        className="mt-1 truncate text-[9px] text-muted sm:text-[10px]"
        title={accountingBasisLabel(source, comparison)}
      >
        {provenanceProviderLabel(source, comparison)} · {provenanceMethodLabel(source)}
      </p>
      <p className={`mt-1 truncate font-mono text-[10px] sm:text-[11px] ${valueTone(yoy)}`}>
        同比 {formatSignedPercent(yoy, missing)} · 推导
      </p>
    </div>
  );
}

function MetricRow({
  label,
  metric,
  currency,
  comparison,
  missingState,
}: {
  label: string;
  metric: StocksEarningsComparison["revenue"];
  currency: string;
  comparison: StocksEarningsComparison;
  missingState: FinancialMissingState;
}) {
  const missing = missingLabel(missingState);
  return (
    <div className="grid grid-cols-[4.2rem_repeat(3,minmax(0,1fr))] items-center gap-2 border-t border-line/60 px-2 py-3 sm:grid-cols-[6rem_repeat(3,minmax(0,1fr))] sm:px-3">
      <p className="text-xs font-semibold text-foreground sm:text-sm">{label}</p>
      <MetricValue
        value={metric.estimate}
        yoy={metric.estimateYoYPct}
        currency={currency}
        source={metric.estimateSource}
        comparison={comparison}
        missingState={missingState}
      />
      <MetricValue
        value={metric.actual}
        yoy={metric.actualYoYPct}
        currency={currency}
        source={metric.actualSource}
        comparison={comparison}
        missingState={missingState}
      />
      <div className="min-w-0 text-right">
        <p
          className={`break-words font-mono text-xs font-semibold sm:text-sm ${valueTone(
            metric.surprisePct,
          )}`}
        >
          {formatSignedMoney(metric.surprise, currency, missing)}
        </p>
        <p
          className={`mt-1 font-mono text-[10px] sm:text-[11px] ${valueTone(
            metric.surprisePct,
          )}`}
        >
          {formatSignedPercent(metric.surprisePct, missing)} · 推导
        </p>
        <p
          className="mt-1 truncate text-[9px] text-muted sm:text-[10px]"
          title={comparison.accountingBasis}
        >
          {derivedProviderLabel(metric, comparison)}
        </p>
      </div>
    </div>
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
  comparison,
  insight,
  updatedAt,
  source,
}: StocksEarningsBriefProps) {
  if (!comparison) {
    return (
      <section
        data-stocks-earnings-brief
        className="rounded-md border border-line/60 bg-panel-strong/80 p-4"
      >
        <h3 className="text-[13px] font-semibold text-muted">财报速览</h3>
        <p className="mt-3 text-sm text-muted">
          财报数据源暂未返回，当前无法生成一致预期比较。
        </p>
      </section>
    );
  }

  const missingState: FinancialMissingState = isFutureOrUnpublished(comparison)
    ? "waiting"
    : "uncovered";

  return (
    <section
      data-stocks-earnings-brief
      className="rounded-md border border-line/60 bg-panel-strong/80"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">财报速览</h3>
            <span className="rounded-md bg-info-soft px-2 py-1 font-mono text-xs font-semibold text-info">
              {comparison.fiscalYear} {comparison.quarter}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {comparison.reportDate ?? "报告日期未知"} · {reportTimingLabel(comparison.reportTiming)} · {comparison.currency}
          </p>
        </div>
        <div className="text-right text-[11px] leading-5 text-muted">
          <p>
            {providerLabel[comparison.provider]} · {comparison.accountingBasis}
          </p>
          <p>{source === "live" ? "缓存已更新" : "本地基线"} · {displayTime(updatedAt)}</p>
        </div>
      </div>

      <div className="px-2 pt-2 sm:px-3">
        <div className="grid grid-cols-[4.2rem_repeat(3,minmax(0,1fr))] gap-2 px-2 py-2 text-right text-[10px] font-semibold text-muted sm:grid-cols-[6rem_repeat(3,minmax(0,1fr))] sm:px-3 sm:text-xs">
          <span className="text-left">指标</span>
          <span>预计值</span>
          <span>公布值</span>
          <span>较预期</span>
        </div>
        <MetricRow
          label="营收"
          metric={comparison.revenue}
          currency={comparison.currency}
          comparison={comparison}
          missingState={missingState}
        />
        <MetricRow
          label="净利润"
          metric={comparison.netIncome}
          currency={comparison.currency}
          comparison={comparison}
          missingState={missingState}
        />
      </div>

      <div className="mt-2 space-y-3 border-t border-line/60 px-4 py-4">
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
