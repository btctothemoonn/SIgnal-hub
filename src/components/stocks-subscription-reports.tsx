"use client";

import { useState } from "react";
import type { StocksSubscriptionReport } from "@/lib/stocks-subscription-reports";

type StocksSubscriptionReportsProps = {
  reports: StocksSubscriptionReport[];
  generatedAt?: string | null;
  onSelectTicker?: (ticker: string) => void;
};

function formatUpdatedAt(raw?: string | null) {
  if (!raw) return "n/a";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function impactTone(impact: StocksSubscriptionReport["impact"]) {
  if (impact === "positive") return "text-success bg-success-soft";
  if (impact === "negative") return "text-danger bg-danger-soft";
  return "text-muted bg-background/45";
}

export function StocksSubscriptionReports({
  reports,
  generatedAt,
  onSelectTicker,
}: StocksSubscriptionReportsProps) {
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  return (
    <section className="min-w-0 rounded-lg border border-line/70 bg-panel-strong shadow-[0_24px_60px_-50px_rgba(38,31,27,0.55)]">
      <div className="flex flex-col gap-2 border-b border-line/60 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">订阅研报</h2>
          <p className="mt-1 text-xs text-muted">
            Patreon / bboczeng · 最新 {reports.length} 条 · 更新 {formatUpdatedAt(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["DRAM", "HBM", "NAND", "SSD", "Memory"].map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-line/60 bg-background/45 px-2 py-1 text-[11px] font-medium text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-3 sm:p-4">
        {reports.length > 0 ? (
          reports.map((report) => {
            const isExpanded = expandedReportId === report.id;
            const summaryText = isExpanded
              ? report.fullSummary || report.summary
              : report.summary;

            return (
              <article
                key={report.id}
                className="rounded-lg border border-line/60 bg-background/35 p-4"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">
                        Patreon
                      </span>
                      <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${impactTone(report.impact)}`}>
                        {report.impact === "positive"
                          ? "正向"
                          : report.impact === "negative"
                            ? "风险"
                            : "中性"}
                      </span>
                      <span className="rounded-md border border-line/60 bg-panel px-2 py-1 text-[11px] text-muted">
                        {report.date}
                      </span>
                      {report.author ? (
                        <span className="rounded-md border border-line/60 bg-panel px-2 py-1 text-[11px] text-muted">
                          {report.author}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-3 break-words text-base font-semibold leading-6 text-foreground sm:text-lg">
                      {report.title}
                    </h3>
                    <p className="mt-2 break-words text-sm leading-6 text-muted">
                      {report.summary}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1.5 xl:max-w-[18rem] xl:justify-end">
                    {report.tickers.map((ticker) => (
                      <button
                        key={ticker}
                        type="button"
                        onClick={() => onSelectTicker?.(ticker)}
                        className="rounded-md border border-line/70 bg-panel px-2 py-1 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:text-accent"
                      >
                        {ticker}
                      </button>
                    ))}
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-4 rounded-lg border border-line/60 bg-panel/70 p-3">
                    <p className="text-xs font-semibold text-muted">总结内容</p>
                    <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-foreground">
                      {summaryText}
                    </p>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpandedReportId(isExpanded ? null : report.id)
                    }
                    className="rounded-md border border-line/70 bg-panel px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:text-accent"
                  >
                    {isExpanded ? "收起" : "展开总结"}
                  </button>
                  {report.link ? (
                    <a
                      href={report.link}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-line/70 bg-panel px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:text-accent"
                    >
                      打开原文
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-lg border border-line/60 bg-background/35 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-foreground">暂无订阅研报</p>
            <p className="mt-2 text-xs text-muted">
              后台会继续刷新 Patreon；有匹配内容后会在这里集中显示。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
