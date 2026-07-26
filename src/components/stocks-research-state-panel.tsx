"use client";

import { useState } from "react";
import type {
  StocksResearchState,
  StocksResearchStateInput,
  StocksResearchStatus,
} from "@/lib/stocks-research-state";

type ResearchStateForm = Omit<StocksResearchStateInput, "ticker">;

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

function formFromState(state: StocksResearchState): ResearchStateForm {
  return {
    status: state.status,
    conviction: state.conviction,
    entryZone: state.entryZone,
    invalidation: state.invalidation,
    nextCatalyst: state.nextCatalyst,
    thesis: state.thesis,
  };
}

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
  return (
    <ResearchStateFormPanel
      key={`${ticker}:${researchState.updatedAt ?? "unsaved"}`}
      ticker={ticker}
      researchState={researchState}
      loading={loading}
      onSave={onSave}
    />
  );
}

function ResearchStateFormPanel({
  ticker,
  researchState,
  loading,
  onSave,
}: StocksResearchStatePanelProps) {
  const [form, setForm] = useState<ResearchStateForm>(() =>
    formFromState(researchState),
  );
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      await onSave({ ticker, ...form });
      setSaveMessage("已保存");
    } catch (error) {
      setSaveError(`保存失败：${saveErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
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
        {saveMessage ? (
          <p aria-live="polite" className="text-xs font-medium text-success">
            {saveMessage}
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold text-muted">状态</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="状态">
          {STATUS_OPTIONS.map((option) => {
            const selected = form.status === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setForm((current) => ({ ...current, status: option.value }))
                }
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selected
                    ? "border-info/60 bg-info-soft text-info"
                    : "border-line/60 bg-background/35 text-muted hover:border-info/40 hover:text-foreground"
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
            value={form.conviction ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                conviction: event.target.value ? Number(event.target.value) : null,
              }))
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
            value={form.entryZone}
            onChange={(event) =>
              setForm((current) => ({ ...current, entryZone: event.target.value }))
            }
            className="mt-1.5 block w-full rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
          />
        </label>

        <label className="min-w-0 text-xs font-medium text-muted">
          失效条件
          <input
            value={form.invalidation}
            onChange={(event) =>
              setForm((current) => ({ ...current, invalidation: event.target.value }))
            }
            className="mt-1.5 block w-full rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
          />
        </label>

        <label className="min-w-0 text-xs font-medium text-muted">
          下个催化
          <input
            value={form.nextCatalyst}
            onChange={(event) =>
              setForm((current) => ({ ...current, nextCatalyst: event.target.value }))
            }
            className="mt-1.5 block w-full rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
          />
        </label>

        <label className="min-w-0 text-xs font-medium text-muted sm:col-span-2">
          研究逻辑
          <textarea
            value={form.thesis}
            onChange={(event) =>
              setForm((current) => ({ ...current, thesis: event.target.value }))
            }
            rows={3}
            className="mt-1.5 block w-full resize-y rounded-md border border-line/60 bg-background/35 px-2.5 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-muted focus:border-info/70"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-xs text-danger">
          {saveError}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || saving}
          className="rounded-md bg-info px-3 py-2 text-sm font-semibold text-background transition-colors hover:bg-info/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "保存中..." : "保存研究状态"}
        </button>
      </div>
    </section>
  );
}
