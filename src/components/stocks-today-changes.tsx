"use client";

import type { StocksTodayChange } from "@/lib/stocks-changes";

type StocksTodayChangesProps = {
  changes: StocksTodayChange[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
};

function toneClasses(tone: StocksTodayChange["tone"]) {
  const classes = {
    positive: "border-success/30 bg-success-soft text-success",
    negative: "border-danger/30 bg-danger-soft text-danger",
  };
  return classes[tone];
}

export function StocksTodayChanges({
  changes,
  selectedTicker,
  onSelectTicker,
}: StocksTodayChangesProps) {
  if (changes.length === 0) return null;

  return (
    <section
      data-testid="stocks-today-changes"
      className="min-w-0 border-y border-line/60 bg-panel-strong/70 px-3 py-2 sm:px-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">今日变化</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            只展示每只股票当前最重要的一项变化
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-medium text-muted">
          {changes.length} 项
        </span>
      </div>

      <div className="grid grid-flow-col auto-cols-[minmax(15rem,18rem)] gap-2 overflow-x-auto pb-1 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-4 lg:overflow-visible">
        {changes.map((item) => {
          const selected = item.ticker === selectedTicker;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectTicker(item.ticker)}
              className={[
                "min-w-0 rounded-md border px-2.5 py-2 text-left transition-colors",
                selected
                  ? "border-accent/55 bg-accent-soft"
                  : "border-line/60 bg-background/35 hover:border-accent/40 hover:bg-background/55",
              ].join(" ")}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">
                  {item.ticker}
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${toneClasses(item.tone)}`}
                >
                  {item.tone === "positive" ? "上涨" : "下跌"}
                </span>
              </span>
              <span className="mt-1 block truncate text-xs font-semibold text-foreground">
                {item.title}
              </span>
              <span className="mt-1 block truncate text-[11px] text-muted">
                {item.detail}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
