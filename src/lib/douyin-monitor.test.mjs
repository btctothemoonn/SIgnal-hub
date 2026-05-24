import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const {
  buildDouyinResearchSummary,
  extractDouyinVideosFromHtml,
  initDouyinMonitorDb,
  listDouyinVideos,
  upsertDouyinVideos,
} = await import("./douyin-monitor.ts");

const renderData = encodeURIComponent(
  JSON.stringify({
    aweme: {
      aweme_id: "745600001",
      desc: "AI 数据中心电力需求继续上修，重点观察 NVDA 与光通信链条。",
      create_time: 1770000000,
      share_url: "https://www.douyin.com/video/745600001",
      video: {
        cover: {
          url_list: ["https://example.test/cover.jpg"],
        },
      },
      author: {
        nickname: "投研样本",
      },
    },
  }),
);

const html = `<html><body><script id="RENDER_DATA" type="application/json">${renderData}</script></body></html>`;
const videos = extractDouyinVideosFromHtml(html, {
  creatorRef: "https://www.douyin.com/user/test",
  fetchedAt: "2026-05-24T01:00:00.000Z",
});

assert.equal(videos.length, 1);
assert.equal(videos[0].id, "745600001");
assert.equal(videos[0].creatorName, "投研样本");
assert.match(videos[0].title, /AI 数据中心/);
assert.equal(videos[0].coverUrl, "https://example.test/cover.jpg");

const summary = buildDouyinResearchSummary(videos[0]);
assert.equal(summary.status, "limited");
assert.match(summary.coreView, /AI 数据中心/);
assert.ok(summary.assets.some((asset) => asset === "NVDA"));
assert.ok(summary.followUps.length > 0);

const dir = await mkdtemp(join(tmpdir(), "signal-hub-douyin-"));
const db = new DatabaseSync(join(dir, "douyin.sqlite"));
try {
  initDouyinMonitorDb(db);
  assert.equal(upsertDouyinVideos(db, videos), 1);
  assert.equal(upsertDouyinVideos(db, videos), 0);
  const rows = listDouyinVideos(db, { limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary?.status, "limited");
} finally {
  db.close();
  await rm(dir, { recursive: true, force: true });
}

console.log("ok - douyin monitor parses, summarizes, and dedupes videos");
