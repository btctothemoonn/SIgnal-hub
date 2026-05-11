"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

type WatchItem = { ref: string; tags: string[] };

type RuntimeConfig = {
  telegramChannels: WatchItem[];
  twitterAccounts: WatchItem[];
};

type SyncResult = { username: string; warning: string | null };

type ApiResponse = {
  success: boolean;
  config?: RuntimeConfig;
  error?: string;
  warning?: string | null;
  syncResults?: SyncResult[];
};

const emptyConfig: RuntimeConfig = {
  telegramChannels: [],
  twitterAccounts: [],
};

async function callSettings(body: unknown): Promise<ApiResponse> {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return (await response.json()) as ApiResponse;
}

async function fetchSettings(): Promise<ApiResponse> {
  const response = await fetch("/api/settings", {
    method: "GET",
    cache: "no-store",
  });
  return (await response.json()) as ApiResponse;
}

function splitInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,\n\s]+/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function stripAt(name: string): string {
  return name.replace(/^@+/, "").trim();
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

type Kind = "telegram" | "twitter";

export default function SettingsPage() {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [config, setConfig] = useState<RuntimeConfig>(emptyConfig);
  const [activeKind, setActiveKind] = useState<Kind>("telegram");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);

  function goHome() {
    startNavigation(() => {
      router.push("/");
    });
  }

  useEffect(() => {
    void fetchSettings().then((result) => {
      if (result.success && result.config) {
        setConfig(result.config);
      } else if (result.error) {
        setError(result.error);
      }
      setLoading(false);
    });
  }, []);

  const handleAction = useCallback(
    async (body: unknown): Promise<ApiResponse> => {
      setBusy(true);
      setError(null);
      setWarning(null);
      setSyncResults(null);
      try {
        const result = await callSettings(body);
        if (result.success && result.config) {
          setConfig(result.config);
          if (result.warning) setWarning(result.warning);
          if (result.syncResults) setSyncResults(result.syncResults);
        } else {
          setError(result.error || "操作失败");
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "网络错误";
        setError(message);
        return { success: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const telegramItems = config.telegramChannels;
  const twitterItems = config.twitterAccounts;

  const sections: Array<{ kind: Kind; title: string; count: number }> = [
    { kind: "telegram", title: "Telegram 频道", count: telegramItems.length },
    { kind: "twitter", title: "X 博主", count: twitterItems.length },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-5 sm:px-6 lg:py-7">
        <header className="flex items-center justify-between gap-4 border-b border-line/70 pb-4">
          <div className="flex items-baseline gap-3">
            <button
              type="button"
              onClick={goHome}
              disabled={navigating}
              className="rounded-lg border border-line/70 bg-panel-strong/90 px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent/35 hover:bg-accent-soft hover:text-accent disabled:opacity-60"
            >
              {navigating ? "返回中..." : "← 返回面板"}
            </button>
            <h1 className="font-serif text-2xl font-medium text-foreground">
              监控设置
            </h1>
          </div>
          <p className="hidden text-xs text-muted sm:block">
            改动保存在 <code className="font-mono">.signal-hub/runtime-config.json</code>
          </p>
        </header>

        <div className="flex flex-col gap-4 md:flex-row">
          <nav className="flex gap-2 overflow-x-auto md:w-44 md:flex-col md:gap-1 md:overflow-visible">
            {sections.map((section) => {
              const isActive = section.kind === activeKind;
              return (
                <button
                  key={section.kind}
                  onClick={() => setActiveKind(section.kind)}
                  className={
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors md:w-full " +
                    (isActive
                      ? "border-accent/45 bg-accent-soft text-accent"
                      : "border-line/70 bg-panel-strong/90 text-muted hover:border-accent/30 hover:bg-panel hover:text-foreground")
                  }
                >
                  <span className="font-medium">{section.title}</span>
                  <span
                    className={
                      "ml-2 rounded-full px-2 py-0.5 text-[11px] " +
                      (isActive
                        ? "bg-foreground/10 text-foreground"
                        : "bg-line/60 text-muted")
                    }
                  >
                    {section.count}
                  </span>
                </button>
              );
            })}
          </nav>

          <section className="flex-1">
            {loading ? (
              <div className="rounded-lg border border-line/70 bg-panel-strong p-6 text-sm text-muted shadow-[0_24px_60px_-48px_rgba(38,31,27,0.55)]">
                加载中...
              </div>
            ) : activeKind === "telegram" ? (
              <WatchListPanel
                key="telegram"
                kind="telegram"
                items={telegramItems}
                busy={busy}
                error={error}
                warning={warning}
                syncResults={null}
                handleAction={handleAction}
              />
            ) : (
              <WatchListPanel
                key="twitter"
                kind="twitter"
                items={twitterItems}
                busy={busy}
                error={error}
                warning={warning}
                syncResults={syncResults}
                handleAction={handleAction}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

type WatchListPanelProps = {
  kind: Kind;
  items: WatchItem[];
  busy: boolean;
  error: string | null;
  warning: string | null;
  syncResults: SyncResult[] | null;
  handleAction: (body: unknown) => Promise<ApiResponse>;
};

function WatchListPanel({
  kind,
  items,
  busy,
  error,
  warning,
  syncResults,
  handleAction,
}: WatchListPanelProps) {
  const [query, setQuery] = useState("");
  const [singleInput, setSingleInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);

  const label = kind === "telegram" ? "Telegram 频道" : "X 博主";
  const placeholder =
    kind === "telegram" ? "@channel 或 t.me/..." : "elonmusk";
  const displayName = (ref: string) => (kind === "twitter" ? `@${ref}` : ref);
  const copyAllLabel =
    kind === "telegram" ? "\u590d\u5236\u9891\u9053\u6e05\u5355" : "\u590d\u5236 X \u6e05\u5355";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.ref.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [items, query]);

  async function addSingle() {
    const value = singleInput.trim();
    if (!value) return;
    const cleaned = kind === "twitter" ? stripAt(value) : value;
    if (!cleaned) return;
    const body =
      kind === "telegram"
        ? { action: "telegram.add", ref: cleaned }
        : { action: "twitter.add", username: cleaned };
    const result = await handleAction(body);
    if (result.success) setSingleInput("");
  }

  async function addBatch() {
    const rawList = splitInput(batchInput);
    const cleaned =
      kind === "twitter" ? rawList.map(stripAt).filter(Boolean) : rawList;
    if (cleaned.length === 0) return;
    const body =
      kind === "telegram"
        ? { action: "telegram.batchAdd", refs: cleaned }
        : { action: "twitter.batchAdd", usernames: cleaned };
    const result = await handleAction(body);
    if (result.success) {
      setBatchInput("");
      setBatchOpen(false);
    }
  }

  async function remove(ref: string) {
    const body =
      kind === "telegram"
        ? { action: "telegram.remove", ref }
        : { action: "twitter.remove", username: ref };
    await handleAction(body);
  }

  async function saveTags(ref: string, tags: string[]) {
    const body =
      kind === "telegram"
        ? { action: "telegram.setTags", ref, tags }
        : { action: "twitter.setTags", username: ref, tags };
    await handleAction(body);
  }

  const failedSyncs =
    kind === "twitter" && syncResults
      ? syncResults.filter((r) => r.warning)
      : [];
  const previewBatch =
    kind === "twitter"
      ? splitInput(batchInput).map(stripAt).filter(Boolean)
      : splitInput(batchInput);

  return (
    <div className="rounded-lg border border-line/70 bg-panel-strong p-5 shadow-[0_24px_60px_-48px_rgba(38,31,27,0.55)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {label}
          <span className="ml-2 text-xs font-normal text-muted">
            {items.length} 条
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <CopyWatchListButton
            disabled={filtered.length === 0}
            label={copyAllLabel}
            text={filtered.map((item) => displayName(item.ref)).join("\n")}
          />
        <input
          type="text"
          placeholder="搜索 名称 / tag"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-48 rounded-lg border border-line/70 bg-background/55 px-3 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none"
        />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          placeholder={placeholder}
          value={singleInput}
          onChange={(e) => setSingleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addSingle();
          }}
          disabled={busy}
          className="flex-1 rounded-lg border border-line/70 bg-background/55 px-4 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
        />
        <button
          onClick={addSingle}
          disabled={busy || !singleInput.trim()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent disabled:opacity-40"
        >
          添加
        </button>
        <button
          onClick={() => setBatchOpen((v) => !v)}
          className="rounded-lg border border-line/70 bg-panel px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
        >
          {batchOpen ? "收起批量" : "批量粘贴"}
        </button>
      </div>

      {batchOpen ? (
        <div className="mt-3 rounded-lg border border-line/70 bg-panel p-3">
          <textarea
            value={batchInput}
            onChange={(e) => setBatchInput(e.target.value)}
            disabled={busy}
            rows={4}
            placeholder={
              kind === "telegram"
                ? "多个频道用逗号/换行分隔\n@channel1, @channel2\n@channel3"
                : "多个账号用逗号/换行分隔\nelonmusk, VitalikButerin\ncz_binance"
            }
            className="w-full resize-y rounded-lg border border-line/70 bg-background/60 px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              解析到 {previewBatch.length} 条
              {previewBatch.length > 0 ? ":" + previewBatch.slice(0, 3).join(", ") : ""}
              {previewBatch.length > 3 ? ` 等 ${previewBatch.length} 条` : ""}
            </p>
            <button
              onClick={addBatch}
              disabled={busy || previewBatch.length === 0}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent disabled:opacity-40"
            >
              添加 {previewBatch.length} 条
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      {warning ? (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          {warning}
        </p>
      ) : null}
      {failedSyncs.length > 0 ? (
        <details className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          <summary className="cursor-pointer font-medium">
            {failedSyncs.length} 条已保存但 6551 同步失败,点开查看
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {failedSyncs.map((r) => (
              <li key={r.username}>
                <span className="font-mono">@{r.username}</span> — {r.warning}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line/70 bg-panel px-3 py-6 text-center text-xs text-muted">
            {items.length === 0
              ? `还没添加 ${label}。`
              : "没有匹配的条目。"}
          </p>
        ) : (
          filtered.map((item) => (
            <WatchItemRow
              key={item.ref}
              displayName={displayName(item.ref)}
              item={item}
              busy={busy}
              copyText={displayName(item.ref)}
              onRemove={() => remove(item.ref)}
              onSaveTags={(tags) => saveTags(item.ref, tags)}
            />
          ))
        )}
      </div>

      <p className="mt-5 text-xs leading-5 text-muted">
        {kind === "telegram"
          ? "Telegram 频道保存后立即热更新下一次抓取。"
          : "X 账号保存时会调用 6551 watch 接口订阅实时事件(消耗 token 额度);已存在的订阅会被忽略。"}
      </p>
    </div>
  );
}

function CopyWatchListButton({
  disabled = false,
  label = "\u590d\u5236",
  text,
}: {
  disabled?: boolean;
  label?: string;
  text: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const buttonText =
    status === "copied"
      ? "\u5df2\u590d\u5236"
      : status === "failed"
        ? "\u590d\u5236\u5931\u8d25"
        : label;

  return (
    <button
      type="button"
      onClick={() => {
        if (!text.trim()) return;
        void copyToClipboard(text).then((ok) => {
          setStatus(ok ? "copied" : "failed");
          window.setTimeout(() => setStatus("idle"), 1500);
        });
      }}
      disabled={disabled || !text.trim()}
      className="rounded-lg border border-line/70 bg-panel px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/35 hover:bg-accent-soft hover:text-accent disabled:opacity-40"
    >
      {buttonText}
    </button>
  );
}

type WatchItemRowProps = {
  displayName: string;
  item: WatchItem;
  busy: boolean;
  copyText: string;
  onRemove: () => void | Promise<void>;
  onSaveTags: (tags: string[]) => void | Promise<void>;
};

function WatchItemRow({
  displayName,
  item,
  busy,
  copyText,
  onRemove,
  onSaveTags,
}: WatchItemRowProps) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(item.tags.join(", "));

  async function save() {
    const tags = input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await onSaveTags(tags);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-panel px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-foreground">{displayName}</span>
        {editing ? null : item.tags.length === 0 ? (
          <span className="text-xs text-muted">无标签</span>
        ) : (
          item.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent"
            >
              {tag}
            </span>
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") {
                  setInput(item.tags.join(", "));
                  setEditing(false);
                }
              }}
              placeholder="多个 tag 用逗号分隔"
              className="w-48 rounded-lg border border-line/70 bg-background/60 px-3 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none"
              autoFocus
            />
            <button
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-colors hover:bg-accent disabled:opacity-40"
            >
              保存
            </button>
            <button
              onClick={() => {
                setInput(item.tags.join(", "));
                setEditing(false);
              }}
              className="text-xs text-muted hover:text-foreground"
            >
              取消
            </button>
          </>
        ) : (
          <>
            <CopyWatchListButton text={copyText} />
            <button
              onClick={() => {
                setInput(item.tags.join(", "));
                setEditing(true);
              }}
              disabled={busy}
              className="rounded-lg border border-line/70 bg-panel-strong px-3 py-1.5 text-xs text-muted hover:border-accent/35 hover:bg-accent-soft hover:text-accent"
            >
              编辑 tag
            </button>
            <button
              onClick={() => void onRemove()}
              disabled={busy}
              className="rounded-lg border border-line/70 bg-panel-strong px-3 py-1.5 text-xs text-muted hover:bg-danger-soft hover:text-danger"
            >
              删除
            </button>
          </>
        )}
      </div>
    </div>
  );
}
