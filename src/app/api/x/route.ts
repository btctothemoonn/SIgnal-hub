import { NextResponse } from "next/server";
import {
  add6551TwitterWatch,
  delete6551TwitterWatch,
  getCached6551TwitterSnapshot,
  invalidate6551TwitterSnapshot,
} from "@/lib/6551-twitter";
import {
  getXPipelineSnapshot,
  upsertXPipelineAccount,
} from "@/lib/x-pipeline-store";
import {
  getSignalFeedRangeLimit,
  getSignalFeedRangeSince,
  normalizeSignalFeedRange,
} from "@/lib/signal-feed-range";
import { isXRestSnapshotMode } from "@/lib/x-snapshot-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AddWatchBody = {
  action: "watch.add";
  username: string;
};

type DeleteWatchBody = {
  action: "watch.delete";
  id: number;
};

type ActionBody = AddWatchBody | DeleteWatchBody;

export async function GET(request: Request) {
  if (isXRestSnapshotMode()) {
    return NextResponse.json(await getCached6551TwitterSnapshot());
  }

  const range = normalizeSignalFeedRange(new URL(request.url).searchParams.get("range"));
  return NextResponse.json(
    getXPipelineSnapshot(getSignalFeedRangeLimit(range, "x"), undefined, {
      since: getSignalFeedRangeSince(range),
    }),
  );
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
    if (body.action === "watch.add") {
      if (!body.username?.trim()) {
        return NextResponse.json(
          { success: false, error: "username 不能为空。" },
          { status: 400 },
        );
      }

      await add6551TwitterWatch(body.username);
      const username = body.username.trim().replace(/^@+/, "");
      upsertXPipelineAccount({
        username,
        name: username,
        profileUrl: `https://x.com/${username}`,
        avatar: `https://unavatar.io/twitter/${username}`,
        note: "manual watch.add",
        tags: [],
      });
    } else if (body.action === "watch.delete") {
      if (!Number.isFinite(body.id)) {
        return NextResponse.json(
          { success: false, error: "id 必须是数字。" },
          { status: 400 },
        );
      }

      await delete6551TwitterWatch(body.id);
    } else {
      return NextResponse.json(
        { success: false, error: "不支持的 action。" },
        { status: 400 },
      );
    }

    if (isXRestSnapshotMode()) {
      await invalidate6551TwitterSnapshot();
    }

    return NextResponse.json({
      success: true,
      snapshot: isXRestSnapshotMode()
        ? await getCached6551TwitterSnapshot()
        : getXPipelineSnapshot(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "6551 操作失败。",
      },
      { status: 500 },
    );
  }
}
