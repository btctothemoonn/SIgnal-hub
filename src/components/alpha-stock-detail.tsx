"use client";

import type { ReactNode } from "react";
import {
  getAlphaResearchSectorById,
  type AlphaCatalystType,
  type AlphaResearchEarningsStatus,
  type AlphaResearchStock,
} from "@/lib/alpha-research-pool";
import { splitStocksCatalystsForDisplay } from "@/lib/stocks-catalyst-display";

type AlphaStockDetailProps = {
  stock: AlphaResearchStock | null;
  marketDataLabel: string;
  marketDataLoading: boolean;
};

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function changeTone(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-muted";
}

function earningsLabel(status: AlphaResearchEarningsStatus) {
  const labels: Record<AlphaResearchEarningsStatus, string> = {
    recent: "已披露",
    upcoming: "临近",
    watch: "观察",
    quiet: "平静",
  };
  return labels[status];
}

function catalystLabel(type: AlphaCatalystType) {
  const labels: Record<AlphaCatalystType, string> = {
    earnings: "财报",
    product: "产品",
    "supply-chain": "供应链",
    analyst: "机构",
    macro: "宏观",
    regulatory: "监管",
    "industry-event": "行业事件",
  };
  return labels[type];
}

function impactLabel(impact: "positive" | "neutral" | "negative") {
  const labels = {
    positive: "正向",
    neutral: "中性",
    negative: "负向",
  };
  return labels[impact];
}

function impactTone(impact: "positive" | "neutral" | "negative") {
  if (impact === "positive") return "text-success";
  if (impact === "negative") return "text-danger";
  return "text-muted";
}

function providerTraceLabel(
  trace: AlphaResearchStock["market"]["providerTrace"],
) {
  if (!trace?.length) return "";
  return trace
    .map((item) => {
      const status =
        item.status === "success"
          ? "成功"
          : item.status === "failed"
            ? "失败"
            : "跳过";
      return `${item.provider}: ${status}`;
    })
    .join(" / ");
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line/60 bg-panel-strong/80 p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-normal text-muted">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <p key={item} className="break-words text-sm leading-6 text-foreground">
          {item}
        </p>
      ))}
    </div>
  );
}

function MetricTile({
  label,
  value,
  note,
  tone = "text-foreground",
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-line/60 bg-background/35 p-3">
      <p className="text-[11px] font-semibold text-muted">{label}</p>
      <p className={`mt-2 min-w-0 break-words font-mono text-xl font-semibold ${tone}`}>
        {value}
      </p>
      <p className="mt-1 min-w-0 break-words text-xs leading-5 text-muted">
        {note}
      </p>
    </div>
  );
}

export function AlphaStockDetail({
  stock,
  marketDataLabel,
  marketDataLoading,
}: AlphaStockDetailProps) {
  if (!stock) {
    return (
      <article className="rounded-lg border border-line/70 bg-panel-strong p-5 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
        <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted">
          暂无可展示 ticker
        </div>
      </article>
    );
  }

  const sector = getAlphaResearchSectorById(stock.sectorId);
  const stockMarketIsLive = stock.market.source === "live";
  const stockMarketIsLoading = marketDataLoading && !stockMarketIsLive;
  const stockCandlesAreLive =
    stock.market.source === "live" && stock.market.candlesSource === "live";
  const stockProviderTraceLabel = providerTraceLabel(stock.market.providerTrace);
  const stockMarketLabel = stockMarketIsLive
    ? (stock.market.dataQualityLabel ??
      `${(stock.market.provider ?? "live").toUpperCase()} live`)
    : stockMarketIsLoading
      ? "行情加载中"
      : "未获取实时价";
  const stockPrePostLabel = stockMarketIsLive
    ? "盘前/盘后未获取"
    : marketDataLabel;
  const stockPriceLabel = stockMarketIsLive
    ? formatUsd(stock.market.lastPrice)
    : stockMarketIsLoading
      ? "行情加载中"
      : "未获取实时价";
  const { subscriptionReports, visibleCatalysts, hiddenCatalysts } =
    splitStocksCatalystsForDisplay(stock.catalysts, 5);
  const businessTags = stock.businessTags.slice(0, 3);
  const dataStatusLabel = stockMarketIsLive
    ? (stock.market.dataQualityLabel ?? stockMarketLabel)
    : stockPrePostLabel;
  const dayChangeLabel = stockMarketIsLive
    ? formatSignedPercent(stock.market.dayChangePct)
    : "待获取";
  const strengthLabel = stockCandlesAreLive
    ? formatSignedPercent(stock.market.sevenDayChangePct)
    : "K 线待补";
  const strengthNote = stockCandlesAreLive
    ? stock.market.relativeStrengthLabel
    : "暂无可用 7 日走势";
  const financialRows = [
    ["营收", stock.financialSnapshot.revenue],
    ["营收同比", stock.financialSnapshot.revenueYoY],
    ["EPS", stock.financialSnapshot.eps],
    ["毛利率", stock.financialSnapshot.grossMargin],
    ["自由现金流", stock.financialSnapshot.freeCashFlow],
    ["指引", stock.financialSnapshot.guidance],
  ];

  return (
    <article className="rounded-lg border border-line/70 bg-panel-strong p-5 shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="grid gap-5 border-b border-line/60 pb-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:items-start">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-muted">研究结论</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <h2 className="font-mono text-2xl font-semibold text-foreground">
              {stock.ticker}
            </h2>
            <span className="text-lg font-semibold text-foreground">
              {stock.companyNameZh}
            </span>
            <span className="pb-0.5 text-xs font-medium text-muted">
              {stock.companyName}
            </span>
          </div>
          <p className="mt-3 max-w-5xl text-sm leading-6 text-foreground">
            {stock.summary}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-info-soft px-2 py-1 text-xs font-semibold text-info">
              {sector?.name ?? stock.sectorId}
            </span>
            <span className="rounded-md bg-warning-soft px-2 py-1 text-xs font-semibold text-warning">
              财报{earningsLabel(stock.market.earningsStatus)}
            </span>
            {businessTags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-line/60 bg-background/45 px-2 py-1 text-[11px] font-medium text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
          <details className="mt-3 max-w-5xl text-xs text-muted">
            <summary className="cursor-pointer select-none hover:text-foreground">
              数据状态
            </summary>
            <p className="mt-2 leading-5">
              {dataStatusLabel}
              {stockProviderTraceLabel ? ` · 链路：${stockProviderTraceLabel}` : ""}
            </p>
          </details>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <MetricTile
            label="价格 / 今日"
            value={stockPriceLabel}
            note={dayChangeLabel}
            tone={stockMarketIsLive ? changeTone(stock.market.dayChangePct) : "text-muted"}
          />
          <MetricTile
            label="7 日强弱"
            value={strengthLabel}
            note={strengthNote}
            tone={stockCandlesAreLive ? changeTone(stock.market.sevenDayChangePct) : "text-muted"}
          />
          <MetricTile
            label="财报窗口"
            value={earningsLabel(stock.market.earningsStatus)}
            note={stock.financialSnapshot.nextEarningsDate}
            tone="text-warning"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)]">
        <div className="space-y-5">
          {subscriptionReports.length > 0 ? (
            <Section title="订阅研报">
              <div className="space-y-3">
                {subscriptionReports.map((report) => (
                  <article
                    key={`${report.date}-${report.title}`}
                    className="rounded-lg border border-accent/45 bg-accent-soft/20 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                        Patreon
                      </span>
                      <span className="text-[11px] text-muted">
                        {report.date}
                      </span>
                      {report.author ? (
                        <span className="text-[11px] text-muted">
                          {report.author}
                        </span>
                      ) : null}
                    </div>
                    <h4 className="mt-2 text-base font-semibold leading-6 text-foreground">
                      {report.link ? (
                        <a
                          href={report.link}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent"
                        >
                          {report.title}
                        </a>
                      ) : (
                        report.title
                      )}
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      {report.summary}
                    </p>
                  </article>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="今日催化">
            <div className="space-y-3">
              {visibleCatalysts.map((catalyst) => (
                <article
                  key={`${catalyst.date}-${catalyst.title}`}
                  className="rounded-lg border border-line/60 bg-panel px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info">
                      {catalystLabel(catalyst.type)}
                    </span>
                    <span className={`text-[11px] font-semibold ${impactTone(catalyst.impact)}`}>
                      {impactLabel(catalyst.impact)}
                    </span>
                    <span className="text-[11px] text-muted">
                      {catalyst.date}
                    </span>
                    {catalyst.source ? (
                      <span className="text-[11px] text-muted">
                        {catalyst.source}
                        {catalyst.author ? ` · ${catalyst.author}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <h4 className="mt-2 text-base font-semibold leading-6 text-foreground">
                    {catalyst.link ? (
                      <a
                        href={catalyst.link}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-accent"
                      >
                        {catalyst.title}
                      </a>
                    ) : (
                      catalyst.title
                    )}
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {catalyst.summary}
                  </p>
                </article>
              ))}
            </div>
            {hiddenCatalysts.length > 0 ? (
              <details className="mt-3 rounded-lg border border-line/60 bg-background/30 px-4 py-3 text-sm">
                <summary className="cursor-pointer select-none font-semibold text-muted hover:text-foreground">
                  更多普通新闻 {hiddenCatalysts.length} 条
                </summary>
                <div className="mt-3 space-y-2">
                  {hiddenCatalysts.map((catalyst) => (
                    <p
                      key={`${catalyst.date}-${catalyst.title}`}
                      className="break-words text-sm leading-6 text-muted"
                    >
                      {catalyst.date} · {catalyst.title}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="财报复盘">
            <div className="grid gap-2 text-sm">
              {financialRows.map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 rounded-md bg-background/45 px-3 py-2"
                >
                  <span className="text-muted">{label}</span>
                  <span className="min-w-0 break-words font-medium text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="主线验证">
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold text-muted">
                  财报 / 经营
                </p>
                <BulletList items={stock.financialReadthrough} />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold text-muted">
                  产业主线
                </p>
                <BulletList items={stock.thesis} />
              </div>
            </div>
          </Section>

          <Section title="接下来盯什么">
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold text-muted">
                  验证点
                </p>
                <BulletList items={stock.watchPoints} />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold text-muted">
                  反证 / 风险
                </p>
                <div className="space-y-2">
                  {stock.risks.map((risk) => (
                    <p key={risk} className="text-sm leading-6 text-warning">
                      {risk}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </article>
  );
}
