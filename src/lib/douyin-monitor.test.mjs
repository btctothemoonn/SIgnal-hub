import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const {
  buildDouyinResearchSummary,
  collapseDouyinRefreshErrors,
  extractDouyinVideosFromHtml,
  initDouyinMonitorDb,
  isDouyinAntiBotChallengeHtml,
  isDouyinLoginWallHtml,
  listDouyinVideos,
  parseDouyinRssFeed,
  parseTikhubDouyinVideos,
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

assert.equal(
  isDouyinAntiBotChallengeHtml(
    '<html><script>window.byted_acrawler.init({aid:99999999});window.location.reload();</script></html>',
  ),
  true,
);
assert.equal(isDouyinLoginWallHtml("<div>看更多最新作品</div><button>登录</button>"), true);

const rssVideos = parseDouyinRssFeed(
  `<?xml version="1.0"?><rss><channel><item><title><![CDATA[AI 光通信更新]]></title><link>https://www.douyin.com/video/745600002</link><description><![CDATA[NVDA CPO 观察]]></description><pubDate>Sun, 24 May 2026 08:00:00 GMT</pubDate></item></channel></rss>`,
  {
    creatorRef: "rsshub:test",
    fetchedAt: "2026-05-24T08:01:00.000Z",
  },
);
assert.equal(rssVideos.length, 1);
assert.equal(rssVideos[0].id, "745600002");
assert.equal(rssVideos[0].source, "rsshub");

const tikhubVideos = parseTikhubDouyinVideos(
  {
    code: 200,
    data: {
      aweme_list: [
        {
          aweme_id: "745600003",
          desc: "HBM 涨价和 MU 财报观察",
          create_time: 1770100000,
          share_url: "https://www.douyin.com/video/745600003",
          author: { nickname: "阿华" },
          video: { cover: { url_list: ["https://example.test/tikhub-cover.jpg"] } },
        },
      ],
    },
  },
  {
    creatorRef: "MS4wLjABAAAA-test",
    fetchedAt: "2026-05-24T08:02:00.000Z",
  },
);
assert.equal(tikhubVideos.length, 1);
assert.equal(tikhubVideos[0].id, "745600003");
assert.equal(tikhubVideos[0].source, "tikhub");
assert.equal(tikhubVideos[0].creatorName, "阿华");

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

const collapsed = collapseDouyinRefreshErrors([
  {
    creatorRef: "same",
    creatorName: null,
    status: "error",
    fetchedAt: "2026-05-24T08:00:00.000Z",
    inserted: 0,
    videoCount: 0,
    error: "old",
  },
  {
    creatorRef: "same",
    creatorName: null,
    status: "error",
    fetchedAt: "2026-05-24T09:00:00.000Z",
    inserted: 0,
    videoCount: 0,
    error: "new",
  },
]);
assert.equal(collapsed.length, 1);
assert.equal(collapsed[0].error, "new");

console.log("ok - douyin monitor parses, summarizes, and dedupes videos");
