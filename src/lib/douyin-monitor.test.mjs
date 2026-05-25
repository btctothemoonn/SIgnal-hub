import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const {
  buildDouyinResearchSummary,
  collapseDouyinRefreshErrors,
  extractDouyinVideosFromHtml,
  fetchDouyinCreatorVideos,
  initDouyinMonitorDb,
  isDouyinAntiBotChallengeHtml,
  isDouyinLoginWallHtml,
  listDouyinVideos,
  parseAiSummaryContent,
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
      share_info: {
        share_url: "https://www.iesdouyin.com/share/video/0000/",
      },
      aweme_list: [
        {
          aweme_id: "745600003",
          desc: "HBM 涨价和 MU 财报观察",
          chapter_abstract:
            "HBM 与谷歌TPU需求共振，重点跟踪博通ASIC、服务器PCB和高速互联供应链。",
          chapter_list: [
            { desc: "谷歌的TPU需求" },
            { desc_for_search: "博通ASIC与PCB供应链" },
          ],
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
assert.equal(tikhubVideos[0].title, "HBM 涨价和 MU 财报观察");
assert.match(tikhubVideos[0].description, /章节摘要/);
assert.match(tikhubVideos[0].description, /谷歌TPU需求/);
assert.match(tikhubVideos[0].description, /博通ASIC与PCB供应链/);
assert.equal(tikhubVideos[0].publishedAt, "2026-02-03T06:26:40.000Z");

const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      detail: {
        code: 402,
        message_zh: "免费额度以及余额不足，此路由需要付费",
        message: "Insufficient balance",
      },
    }),
    { status: 402, headers: { "content-type": "application/json" } },
  );
await assert.rejects(
  () =>
    fetchDouyinCreatorVideos({
      creatorRef: "MS4wLjABAAAA-test",
      env: {
        DOUYIN_PROVIDER: "tikhub",
        DOUYIN_TIKHUB_API_KEY: "test-key",
      },
    }),
  /免费额度以及余额不足/,
);
globalThis.fetch = originalFetch;

const summary = buildDouyinResearchSummary(videos[0]);
assert.equal(summary.status, "limited");
assert.match(summary.coreView, /AI 数据中心/);
assert.ok(summary.assets.some((asset) => asset === "NVDA"));
assert.ok(summary.followUps.length > 0);

const aShareSummary = buildDouyinResearchSummary({
  title: "PCB 覆铜板 CCL 和 CPO 光模块继续发酵，长鑫存储带动存储芯片炒作逻辑",
  description: "",
});
assert.deepEqual(aShareSummary.assets.slice(0, 3), [
  "A股: PCB/覆铜板",
  "A股: CPO/光模块",
  "A股: 存储芯片",
]);
assert.match(aShareSummary.catalysts.join("\n"), /炒作逻辑/);

const aShareAliasSummary = buildDouyinResearchSummary({
  title: "沪电继续受益PCB高阶化，光模块需求带动炒作逻辑",
  description: "",
});
assert.deepEqual(aShareAliasSummary.assets.slice(0, 3), [
  "A股: 沪电股份",
  "A股: PCB/覆铜板",
  "A股: CPO/光模块",
]);
assert.match(aShareAliasSummary.recommendationReasons.join("\n"), /AI服务器|高阶PCB|光模块/);

const googleChainSummary = buildDouyinResearchSummary({
  title: "谷歌TPU放量，博通ASIC和沪电PCB供应链受益",
  description: "",
});
assert.deepEqual(googleChainSummary.assets.slice(0, 4), [
  "A股: 沪电股份",
  "A股: PCB/覆铜板",
  "谷歌TPU/AI ASIC产业链",
  "AVGO",
]);
assert.match(googleChainSummary.recommendationReasons.join("\n"), /谷歌|TPU|ASIC|博通|PCB/);

const freeformAiSummary = parseAiSummaryContent(
  "核心观点：PCB 和 CPO 光模块继续发酵，A股炒作逻辑来自AI服务器高阶材料需求。",
);
assert.equal(freeformAiSummary.status, "generated");
assert.deepEqual(freeformAiSummary.assets.slice(0, 2), [
  "A股: PCB/覆铜板",
  "A股: CPO/光模块",
]);
assert.match(freeformAiSummary.catalysts.join("\n"), /炒作逻辑/);

const jsonAiSummary = parseAiSummaryContent(
  JSON.stringify({
    coreView: "内容有限：视频标题提及PCB和光模块板块分析，暗示存在预期差",
    assets: ["PCB板块", "光模块板块"],
    recommendationReasons: ["博主认为AI服务器需求会带动高阶PCB订单"],
    catalysts: ["内容有限：无法确认具体催化逻辑"],
    risks: [],
    followUps: [],
  }),
);
assert.deepEqual(jsonAiSummary.assets.slice(0, 2), [
  "A股: PCB/覆铜板",
  "A股: CPO/光模块",
]);
assert.match(jsonAiSummary.catalysts[0], /A股板块炒作逻辑/);
assert.match(jsonAiSummary.recommendationReasons.join("\n"), /AI服务器|高阶PCB|光模块/);

const dir = await mkdtemp(join(tmpdir(), "signal-hub-douyin-"));
const db = new DatabaseSync(join(dir, "douyin.sqlite"));
try {
  initDouyinMonitorDb(db);
  assert.equal(upsertDouyinVideos(db, videos), 1);
  assert.equal(upsertDouyinVideos(db, videos), 0);
  upsertDouyinVideos(db, [
    {
      ...videos[0],
      id: "no-published-time",
      title: "Missing publish time",
      publishedAt: null,
      fetchedAt: "2026-05-25T00:00:00.000Z",
    },
  ]);
  upsertDouyinVideos(db, [
    {
      ...videos[0],
      id: "before-cutoff",
      title: "Before cutoff",
      publishedAt: "2026-05-23T15:59:59.000Z",
      fetchedAt: "2026-05-25T00:00:00.000Z",
    },
  ]);
  upsertDouyinVideos(db, [
    {
      ...videos[0],
      id: "after-cutoff",
      title: "After cutoff",
      publishedAt: "2026-05-23T16:00:00.000Z",
      fetchedAt: "2026-05-25T00:00:00.000Z",
    },
  ]);
  const rows = listDouyinVideos(db, { limit: 10 });
  assert.equal(rows.length, 4);
  assert.equal(rows.find((row) => row.id === "745600001")?.summary?.status, "limited");
  const filteredRows = listDouyinVideos(db, {
    limit: 10,
    minPublishedAt: "2026-05-24T00:00:00+08:00",
  });
  assert.deepEqual(filteredRows.map((row) => row.id), ["after-cutoff"]);
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
const suppressedByOk = collapseDouyinRefreshErrors([
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
    status: "ok",
    fetchedAt: "2026-05-24T10:00:00.000Z",
    inserted: 1,
    videoCount: 1,
    error: null,
  },
]);
assert.equal(suppressedByOk.length, 0);

console.log("ok - douyin monitor parses, summarizes, and dedupes videos");
