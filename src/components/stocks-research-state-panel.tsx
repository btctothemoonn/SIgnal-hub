"use client";

import { type FormEvent, useState } from "react";
import type {
  StocksResearchState,
  StocksResearchStateInput,
  StocksResearchStatus,
} from "@/lib/stocks-research-state";
import {
  beginResearchStateSave,
  createResearchStatePanelState,
  finishResearchStateSave,
  type ResearchStateSaveOperation,
  syncResearchStatePanelState,
  updateResearchStateForm,
} from "@/components/stocks-research-state-form";

type StocksResearchStatePanelProps = {
  ticker: string;
  researchState: StocksResearchState;
  loading: boolean;
  onSave: (input: StocksResearchStateInput) => Promise<void>;
};

const STATUS_OPTIONS: Array<{ value: StocksResearchStatus; label: string }> = [
  { value: "watch", label: "观察" },
  { value: "waiting", label: "等待" },
  { value: "holding", label: "持有" },
  { value: "avoid", label: "回避" },
];

function formatUpdatedAt(updatedAt: string | null) {
  if (!updatedAt) return "暂无保存记录";

  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "暂无保存记录";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function saveErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "请稍后重试";
}

export function StocksResearchStatePanel({
  ticker,
  researchState,
  loading,
  onSave,
}: StocksResearchStatePanelProps) {
  const sourceKey = `${ticker}:${researchState.updatedAt ?? "unsaved"}`;
  const [stateKey, setStateKey] = useState(sourceKey);
  const [panelState, setPanelState] = useState(() =>
    createResearchStatePanelState(researchState),
  );

  // Reconcile server changes without discarding an in-flight save completion.
  if (stateKey !== sourceKey) {
    setStateKey(sourceKey);
    setPanelState((current) =>
      syncResearchStatePanelState(current, researchState),
    );
  }

  async function saveResearchState(operation: ResearchStateSaveOperation) {
    try {
      await onSave(operation.input);
      setPanelState((current) =>
        finishResearchStateSave(current, operation.id, { ok: true }),
      );
    } catch (error) {
      setPanelState((current) =>
        finishResearchStateSave(current, operation.id, {
          ok: false,
          error: saveErrorMessage(error),
        }),
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const started = beginResearchStateSave(panelState, loading);
    if (!started.operation) return;

    setPanelState(started.state);
    void saveResearchState(started.operation);
  }

  return (
    <section
      aria-label="研究状态"
      className="rounded-lg border border-line/60 bg-panel/70 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">研究状态</h3>
          <p className="mt-1 text-xs text-muted">
            最近更新：{formatUpdatedAt(researchState.updatedAt)}
          </p>
        </div>
        {panelState.saveStatus === "saved" ? (
          <p aria-live="polite" className="text-xs font-medium text-success">
            已保存
          </p>
        ) : null}
      </div>

      <form className="mt-4" onSubmit={handleSubmit}>
        <div>
          <p className="text-[11px] font-semibold text-muted">状态</p>
          <div
            className="mt-2 inline-flex overflow-hidden rounded-md border border-line/60"
            role="group"
            aria-label="状态"
          >
            {STATUS_OPTIONS.map((option, index) => {
              const selected = panelState.form.status === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setPanelState((current) =>
                      updateResearchStateForm(current, { status: option.value }),
                    )
                  }
                  className={`border-line/60 px-3 py-1.5 text-xs font-semibold transition-colors ${
                    index > 0 ? "border-l" : ""
                  } ${
                    selected
                      ? "bg-info-soft text-info"
                      : "bg-background/35 text-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-medium text-muted">
            信心
            <select
              value={panelState.form.conviction ?? ""}
              onChange={(event) =>
                setPanelState((current) =>
                  updateResearchStateForm(current, {
                    conviction: event.target.value
                      ? Number(event.target.value)
                      : null,
                  }),
                )
              }
              className="mt-1.5 block w-full rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm text-foreground outline-none transition-colors focus:border-info/70"
            >
              <option value="">清除</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0 text-xs font-medium text-muted">
            买入区
            <input
              value={panelState.form.entryZone}
              onChange={(event) =>
                setPanelState((current) =>
                  updateResearchStateForm(current, { entryZone: event.target.value }),
                )
              }
              className="mt-1.5 block w-full rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
            />
          </label>

          <label className="min-w-0 text-xs font-medium text-muted">
            失效条件
            <input
              value={panelState.form.invalidation}
              onChange={(event) =>
                setPanelState((current) =>
                  updateResearchStateForm(current, {
                    invalidation: event.target.value,
                  }),
                )
              }
              className="mt-1.5 block w-full rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
            />
          </label>

          <label className="min-w-0 text-xs font-medium text-muted">
            下个催化
            <input
              value={panelState.form.nextCatalyst}
              onChange={(event) =>
                setPanelState((current) =>
                  updateResearchStateForm(current, {
                    nextCatalyst: event.target.value,
                  }),
                )
              }
              className="mt-1.5 block w-full rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
            />
          </label>

          <label className="min-w-0 text-xs font-medium text-muted sm:col-span-2">
            研究逻辑
            <textarea
              value={panelState.form.thesis}
              onChange={(event) =>
                setPanelState((current) =>
                  updateResearchStateForm(current, { thesis: event.target.value }),
                )
              }
              rows={3}
              className="mt-1.5 block w-full resize-y rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-xs text-danger">
            {panelState.saveStatus === "error"
              ? `保存失败：${panelState.saveError}`
              : null}
          </p>
          <button
            type="submit"
            disabled={loading || panelState.saving}
            className="rounded-md bg-info px-3 py-2 text-sm font-semibold text-background transition-colors hover:bg-info/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {panelState.saving ? "保存中..." : "保存研究状态"}
          </button>
        </div>
      </form>
    </section>
  );
}
