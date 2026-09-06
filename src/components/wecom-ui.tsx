"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const wecomIconButton = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-workspace-line-strong text-muted transition-colors hover:bg-accent-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
export const wecomCommand = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-workspace-line-strong px-3 py-1.5 text-xs font-medium hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";

const shanghai = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
export function WecomTime({ value }: { value: string | null }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>未提供</span>;
  return <time dateTime={value}>{shanghai.format(new Date(value))}</time>;
}

export function WecomField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{children}</dd></div>;
}

export function WecomAddress({ address, network }: { address: string; network: string }) {
  const [feedback, setFeedback] = useState("");
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      if (alive.current) setFeedback("已复制");
    } catch {
      if (alive.current) setFeedback("复制失败");
    }
  }
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium text-muted [overflow-wrap:anywhere]">{network}</span>
          <p className="select-text break-all font-mono text-sm leading-6">{address}</p>
        </div>
        <button type="button" title="复制地址" aria-label="复制地址" className={wecomIconButton} onClick={copy}>
          {feedback === "已复制" ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
        </button>
      </div>
      <span role="status" className="block min-h-4 text-xs text-muted">{feedback}</span>
    </div>
  );
}
