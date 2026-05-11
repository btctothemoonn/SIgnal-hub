import assert from "node:assert/strict";
import {
  isRetryableXHybridFetchError,
  parseXHybridTelegramCandidate,
  selectBestTweetMatch,
  shouldProcessXHybridSourceStatus,
} from "./x-hybrid-telegram.ts";

const candidateFromButton = parseXHybridTelegramCandidate({
  sourceId: "telegram:65510001:10",
  messageUrl: "https://t.me/xxxx6551monitor/10",
  text: [
    "🌟 监控到新推文",
    "你关注的用户: 川沐 | Trumoo🐮 (备注:川沐 | Trumoo🐮)",
    "推文内容: 世界在被AI深刻变革，",
  ].join("\n"),
  createdAt: "2026-04-28T00:00:00.000Z",
  raw: {
    buttons: [
      {
        text: "View Details",
        url: "https://x.com/xiaomustock/status/2049000000000000001",
      },
    ],
  },
});

assert.equal(candidateFromButton?.tweetId, "2049000000000000001");
assert.equal(candidateFromButton?.username, "xiaomustock");
assert.equal(candidateFromButton?.tweetUrl, "https://x.com/xiaomustock/status/2049000000000000001");
assert.equal(candidateFromButton?.summary.includes("世界在被AI深刻变革"), true);

const candidateFromText = parseXHybridTelegramCandidate({
  sourceId: "telegram:65510001:11",
  messageUrl: "https://t.me/xxxx6551monitor/11",
  text: "新推 https://twitter.com/WatcherGuru/status/2048993047942181129",
  createdAt: "2026-04-28T00:01:00.000Z",
  raw: {},
});

assert.equal(candidateFromText?.tweetId, "2048993047942181129");
assert.equal(candidateFromText?.username, "WatcherGuru");

const quoteAlertCandidate = parseXHybridTelegramCandidate({
  sourceId: "telegram:65510001:14",
  messageUrl: "https://t.me/xxxx6551monitor/14",
  text: [
    "\u{1F31F}\u76d1\u63a7\u5230\u65b0\u63a8\u6587\u5f15\u7528",
    "\u4f60\u5173\u6ce8\u7684\u7528\u6237: \u84dd\u72d0(\u5907\u6ce8:\u84dd\u72d0)",
    "\u7528\u6237\u6240\u5c5e\u5206\u7ec4: \u9ed8\u8ba4\u5206\u7ec4",
    "\u5f15\u7528\u5185\u5bb9: polymarket\u8981\u5728\u4e16\u754c\u676f\u524d\u53d1\u5e01\u5417\uff1f https://x.com/mustafap0ly/status/2051297873812168846",
  ].join("\n"),
  createdAt: "2026-05-05T03:46:20.000Z",
  raw: {
    buttons: [
      {
        text: "View Details",
        url: "https://x.com/lanhubiji/status/2051508763459486161",
      },
    ],
  },
});

assert.equal(quoteAlertCandidate?.username, "lanhubiji");
assert.equal(quoteAlertCandidate?.tweetId, "2051508763459486161");
assert.equal(
  quoteAlertCandidate?.tweetUrl,
  "https://x.com/lanhubiji/status/2051508763459486161",
);

const candidateWithMultilineBody = parseXHybridTelegramCandidate({
  sourceId: "telegram:65510001:13",
  messageUrl: "https://t.me/xxxx6551monitor/13",
  text: [
    "\u{1F31F}\u76d1\u63a7\u5230\u65b0\u63a8\u6587",
    "\u4f60\u5173\u6ce8\u7684\u7528\u6237: Example",
    "\u7528\u6237\u6240\u5c5e\u5206\u7ec4: default",
    "\u63a8\u6587\u5185\u5bb9: first line,",
    "second line,",
    "third line. https://x.com/example/status/2049000000000000013",
  ].join("\n"),
  createdAt: "2026-04-28T00:03:00.000Z",
  raw: {},
});

assert.equal(
  candidateWithMultilineBody?.summary,
  "first line,\nsecond line,\nthird line.",
);

const best = selectBestTweetMatch(
  {
    sourceId: "telegram:65510001:12",
    messageUrl: "https://t.me/xxxx6551monitor/12",
    createdAt: "2026-04-28T00:02:00.000Z",
    username: "WatcherGuru",
    tweetId: "2",
    tweetUrl: "https://x.com/WatcherGuru/status/2",
    summary: "Google signs classified AI deal",
  },
  [
    { id: "1", text: "unrelated", createdAt: "2026-04-28T00:00:00.000Z" },
    {
      id: "2",
      text: "JUST IN: Google signs classified AI deal with the Pentagon.",
      createdAt: "2026-04-28T00:01:00.000Z",
    },
  ],
);

assert.equal(best?.id, "2");

assert.equal(shouldProcessXHybridSourceStatus(null), true);
assert.equal(
  shouldProcessXHybridSourceStatus({
    status: "error",
  }),
  false,
);
assert.equal(
  shouldProcessXHybridSourceStatus(
    {
      status: "error",
    },
    { retryErrors: true },
  ),
  true,
);
assert.equal(
  shouldProcessXHybridSourceStatus({
    status: "pending",
  }),
  true,
);
assert.equal(
  shouldProcessXHybridSourceStatus(
    {
      status: "pending",
      updatedAt: "2026-05-09T06:00:00.000Z",
    },
    {
      nowMs: Date.parse("2026-05-09T06:02:00.000Z"),
      pendingRetryMs: 5 * 60_000,
    },
  ),
  false,
);
assert.equal(
  shouldProcessXHybridSourceStatus(
    {
      status: "pending",
      updatedAt: "2026-05-09T06:00:00.000Z",
    },
    {
      nowMs: Date.parse("2026-05-09T06:06:00.000Z"),
      pendingRetryMs: 5 * 60_000,
    },
  ),
  true,
);
assert.equal(
  isRetryableXHybridFetchError(
    new Error(
      '6551 限流 (429)：{"error":"The skill is being invoked too frequently."}',
    ),
  ),
  true,
);
assert.equal(isRetryableXHybridFetchError(new Error("not found")), false);
assert.equal(
  shouldProcessXHybridSourceStatus(
    {
      status: "ignored",
      tweetId: "old-tweet-id",
    },
    { candidateTweetId: "new-tweet-id" },
  ),
  true,
);
assert.equal(
  shouldProcessXHybridSourceStatus(
    {
      status: "ignored",
      tweetId: "same-tweet-id",
    },
    { candidateTweetId: "same-tweet-id" },
  ),
  false,
);
for (const status of ["enriched", "fallback", "cooldown", "ignored"]) {
  assert.equal(
    shouldProcessXHybridSourceStatus({ status }),
    false,
    `${status} should not be processed again`,
  );
}

console.log("ok - x hybrid telegram parser extracts tweet candidates");
