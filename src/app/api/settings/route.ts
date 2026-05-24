import { NextResponse } from "next/server";
import {
  addDouyinCreator,
  addDouyinCreators,
  addTelegramChannel,
  addTelegramChannels,
  addTwitterAccount,
  addTwitterAccounts,
  loadRuntimeConfig,
  removeDouyinCreator,
  removeTelegramChannel,
  removeTwitterAccount,
  setDouyinCreatorTags,
  setTelegramChannelTags,
  setTwitterAccountTags,
  type RuntimeConfig,
} from "@/lib/runtime-config";
import { reloadTelegramChannels } from "@/lib/telegram-channels";
import {
  add6551TwitterWatch,
  delete6551TwitterWatch,
  get6551TwitterWatchAccounts,
  has6551TwitterToken,
} from "@/lib/6551-twitter";
import {
  buildMonitor985RequestHeaders,
  buildMonitor985RequestUrl,
  describeMonitor985AuthMode,
} from "@/lib/monitor985-auth";
import {
  buildMonitor985FollowExtraBody,
  buildMonitor985UnfollowBody,
} from "@/lib/monitor985-watch-config";
import { isMonitor985Enabled, isXPipelineEnabled } from "@/lib/x-pipeline-config";

export const dynamic = "force-dynamic";

type ActionBody =
  | { action: "telegram.add"; ref: string }
  | { action: "telegram.remove"; ref: string }
  | { action: "telegram.batchAdd"; refs: string[] }
  | { action: "telegram.setTags"; ref: string; tags: string[] }
  | { action: "twitter.add"; username: string }
  | { action: "twitter.remove"; username: string }
  | { action: "twitter.batchAdd"; usernames: string[] }
  | { action: "twitter.setTags"; username: string; tags: string[] }
  | { action: "douyin.add"; ref: string }
  | { action: "douyin.remove"; ref: string }
  | { action: "douyin.batchAdd"; refs: string[] }
  | { action: "douyin.setTags"; ref: string; tags: string[] };

type TwitterSyncResult = { username: string; warning: string | null };

export async function GET() {
  const config = await loadRuntimeConfig();
  return NextResponse.json({ success: true, config });
}

const WATCH_PLAN_GATE = /upgrade|higher plan|403/i;

async function postMonitor985Watch(path: string, body: Record<string, unknown>) {
  const response = await fetch(
    buildMonitor985RequestUrl(
      path,
      process.env.MONITOR985_BASE_URL || "https://985monitor.xyz",
    ),
    {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        ...buildMonitor985RequestHeaders(),
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`985monitor HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }
}

async function syncMonitor985WatchAdd(username: string): Promise<string | null> {
  if (!isMonitor985Enabled() || describeMonitor985AuthMode() === "public") {
    return null;
  }
  try {
    await postMonitor985Watch(
      "/api/me/watch-config/follow-extra",
      buildMonitor985FollowExtraBody(username),
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `本地已保存，但同步到 985 失败：${message}`;
  }
}

async function syncMonitor985WatchRemove(username: string): Promise<string | null> {
  if (!isMonitor985Enabled() || describeMonitor985AuthMode() === "public") {
    return null;
  }
  try {
    await postMonitor985Watch(
      "/api/me/watch-config/unfollow",
      buildMonitor985UnfollowBody(username),
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `本地已删除，但同步到 985 失败：${message}`;
  }
}

async function sync6551TwitterWatchAdd(username: string): Promise<string | null> {
  if (!isXPipelineEnabled() || !has6551TwitterToken()) {
    return null;
  }
  try {
    await add6551TwitterWatch(username);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/exist|duplicate/i.test(message) || WATCH_PLAN_GATE.test(message)) {
      return null;
    }
    return `本地已保存，但同步到 6551 失败：${message}`;
  }
}

async function sync6551TwitterWatchRemove(username: string): Promise<string | null> {
  if (!isXPipelineEnabled() || !has6551TwitterToken()) {
    return null;
  }
  try {
    const remote = await get6551TwitterWatchAccounts();
    const target = remote.find(
      (item) => item.username.toLowerCase() === username.trim().toLowerCase(),
    );
    if (!target || target.id === null) {
      return null;
    }
    await delete6551TwitterWatch(target.id);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (WATCH_PLAN_GATE.test(message)) {
      return null;
    }
    return `本地已删除，但同步到 6551 失败：${message}`;
  }
}

function combineWarnings(warnings: Array<string | null>): string | null {
  const cleaned = warnings.filter((warning): warning is string => Boolean(warning));
  return cleaned.length > 0 ? cleaned.join("；") : null;
}

async function syncTwitterWatchAdd(username: string): Promise<string | null> {
  return combineWarnings([
    await syncMonitor985WatchAdd(username),
    await sync6551TwitterWatchAdd(username),
  ]);
}

async function syncTwitterWatchRemove(username: string): Promise<string | null> {
  return combineWarnings([
    await syncMonitor985WatchRemove(username),
    await sync6551TwitterWatchRemove(username),
  ]);
}

function sanitizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export async function POST(request: Request) {
  let body: ActionBody;

  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体必须是合法 JSON。" },
      { status: 400 },
    );
  }

  try {
    let config: RuntimeConfig;
    let warning: string | null = null;
    let syncResults: TwitterSyncResult[] | null = null;

    switch (body.action) {
      case "telegram.add": {
        if (!body.ref?.trim()) {
          return NextResponse.json(
            { success: false, error: "频道不能为空。" },
            { status: 400 },
          );
        }
        config = await addTelegramChannel(body.ref);
        await reloadTelegramChannels();
        break;
      }
      case "telegram.remove": {
        if (!body.ref?.trim()) {
          return NextResponse.json(
            { success: false, error: "频道不能为空。" },
            { status: 400 },
          );
        }
        config = await removeTelegramChannel(body.ref);
        await reloadTelegramChannels();
        break;
      }
      case "telegram.batchAdd": {
        const refs = sanitizeStringList(body.refs);
        if (refs.length === 0) {
          return NextResponse.json(
            { success: false, error: "没有可添加的频道。" },
            { status: 400 },
          );
        }
        config = await addTelegramChannels(refs);
        await reloadTelegramChannels();
        break;
      }
      case "telegram.setTags": {
        if (!body.ref?.trim()) {
          return NextResponse.json(
            { success: false, error: "频道不能为空。" },
            { status: 400 },
          );
        }
        const tags = Array.isArray(body.tags) ? body.tags : [];
        config = await setTelegramChannelTags(body.ref, tags);
        break;
      }
      case "twitter.add": {
        if (!body.username?.trim()) {
          return NextResponse.json(
            { success: false, error: "X 账号不能为空。" },
            { status: 400 },
          );
        }
        config = await addTwitterAccount(body.username);
        warning = await syncTwitterWatchAdd(body.username);
        break;
      }
      case "twitter.remove": {
        if (!body.username?.trim()) {
          return NextResponse.json(
            { success: false, error: "X 账号不能为空。" },
            { status: 400 },
          );
        }
        warning = await syncTwitterWatchRemove(body.username);
        config = await removeTwitterAccount(body.username);
        break;
      }
      case "twitter.batchAdd": {
        const usernames = sanitizeStringList(body.usernames).map((name) =>
          name.replace(/^@+/, ""),
        );
        const cleaned = sanitizeStringList(usernames);
        if (cleaned.length === 0) {
          return NextResponse.json(
            { success: false, error: "没有可添加的账号。" },
            { status: 400 },
          );
        }
        const before = await loadRuntimeConfig();
        const existing = new Set(
          before.twitterAccounts.map((item) => item.ref.toLowerCase()),
        );
        const newlyAdded = cleaned.filter(
          (name) => !existing.has(name.toLowerCase()),
        );
        config = await addTwitterAccounts(cleaned);
        const results: TwitterSyncResult[] = [];
        for (const username of newlyAdded) {
          const sync = await syncTwitterWatchAdd(username);
          results.push({ username, warning: sync });
        }
        syncResults = results;
        break;
      }
      case "twitter.setTags": {
        if (!body.username?.trim()) {
          return NextResponse.json(
            { success: false, error: "X 账号不能为空。" },
            { status: 400 },
          );
        }
        const tags = Array.isArray(body.tags) ? body.tags : [];
        config = await setTwitterAccountTags(body.username, tags);
        break;
      }
      case "douyin.add": {
        if (!body.ref?.trim()) {
          return NextResponse.json(
            { success: false, error: "抖音博主链接不能为空。" },
            { status: 400 },
          );
        }
        config = await addDouyinCreator(body.ref);
        break;
      }
      case "douyin.remove": {
        if (!body.ref?.trim()) {
          return NextResponse.json(
            { success: false, error: "抖音博主链接不能为空。" },
            { status: 400 },
          );
        }
        config = await removeDouyinCreator(body.ref);
        break;
      }
      case "douyin.batchAdd": {
        const refs = sanitizeStringList(body.refs);
        if (refs.length === 0) {
          return NextResponse.json(
            { success: false, error: "没有可添加的抖音博主。" },
            { status: 400 },
          );
        }
        config = await addDouyinCreators(refs);
        break;
      }
      case "douyin.setTags": {
        if (!body.ref?.trim()) {
          return NextResponse.json(
            { success: false, error: "抖音博主链接不能为空。" },
            { status: 400 },
          );
        }
        const tags = Array.isArray(body.tags) ? body.tags : [];
        config = await setDouyinCreatorTags(body.ref, tags);
        break;
      }
      default: {
        return NextResponse.json(
          { success: false, error: "不支持的 action。" },
          { status: 400 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      config,
      warning,
      ...(syncResults ? { syncResults } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "设置更新失败。",
      },
      { status: 500 },
    );
  }
}
