"use client";

import { useEffect, useState } from "react";

type AiUsageSummary = {
  windowDays: number;
  totals: { calls: number; errors: number };
  byDay: Array<{ day: string; calls: number; errors: number }>;
  byProvider: Array<{ providerId: string; model: string; calls: number; errors: number }>;
};

export function AiUsagePanel() {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof fetch !== "function") return;
    let cancelled = false;
    void fetch("/api/ai-usage", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as AiUsageSummary;
      if (!cancelled) setSummary(body);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "无法读取");
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="rounded-xl border border-workspace-line-strong bg-workspace-surface p-4 sm:p-5" aria-label="AI 调用">
      <h2 className="text-base font-semibold text-foreground">AI 调用（近 7 日）</h2>
      <p className="mt-2 text-sm leading-6 text-muted">只统计生成和翻译请求的次数与失败，不显示密钥。供应商仍以 MiniMax-M3 为准，这里不会切换模型。</p>
      {error ? <p className="mt-3 text-sm text-warning">{error}</p> : null}
      {summary ? (
        <div className="mt-4 space-y-2 text-sm text-foreground">
          <p>调用 {summary.totals.calls} · 失败 {summary.totals.errors}</p>
          <ul className="space-y-1 text-xs text-muted">
            {summary.byProvider.length ? summary.byProvider.map((row) => (
              <li key={`${row.providerId}:${row.model}`}>{row.providerId} · {row.model} · {row.calls} 次成功 / {row.errors} 次失败</li>
            )) : <li>这 7 天还没有记录。</li>}
          </ul>
          <ul className="space-y-1 text-xs text-muted">
            {summary.byDay.map((row) => <li key={row.day}>{row.day} · {row.calls} 成功 / {row.errors} 失败</li>)}
          </ul>
        </div>
      ) : error ? null : <p className="mt-3 text-sm text-muted">读取中…</p>}
    </section>
  );
}
