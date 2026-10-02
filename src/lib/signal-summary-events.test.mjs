import assert from "node:assert/strict";
import test from "node:test";
import {
  bindSignalSummaryEvidence,
  buildSignalSummaryPrompt,
  parseSignalSummaryEvents,
} from "./signal-summary-events.ts";

const reportedEvent = {
  title: "协议升级公布测试窗口",
  change: "团队称测试窗口将在下周开放。",
  whyTrack: "测试结果可能改变部署时间。",
  evidenceType: "reported",
  watch: ["团队公布测试结果"],
  invalidate: ["团队撤回测试安排"],
  sourceIds: ["tg:42"],
};

test("parses a reported event without treating missing provenance as verified", () => {
  assert.deepEqual(parseSignalSummaryEvents([reportedEvent]), [{
    ...reportedEvent,
    sources: [],
  }]);
  assert.equal(parseSignalSummaryEvents([{
    ...reportedEvent,
    evidenceType: "verified",
  }])[0].evidenceType, "inference");
});

test("omits malformed or incomplete cards and accepts an events wrapper", () => {
  assert.deepEqual(parseSignalSummaryEvents({ events: [
    null,
    1,
    [],
    { ...reportedEvent, title: " " },
    { ...reportedEvent, change: null },
    { ...reportedEvent, whyTrack: "" },
    reportedEvent,
  ] }), [{ ...reportedEvent, sources: [] }]);
  for (const value of [null, "bad json", {}, { events: {} }]) {
    assert.deepEqual(parseSignalSummaryEvents(value), []);
  }
});

for (const field of ["watch", "invalidate"]) {
  test(`rejects an event with missing, empty, or unusable ${field} conditions`, () => {
    for (const conditions of [undefined, null, [], ["", " \n ", null, 7], "next update"]) {
      const incomplete = { ...reportedEvent, [field]: conditions, sources: [] };
      assert.deepEqual(parseSignalSummaryEvents([incomplete]), [], String(conditions));
      assert.deepEqual(bindSignalSummaryEvidence([incomplete], [originalMessage]), [], String(conditions));
    }
  });
}

test("keeps a complete event after rejected cards and preserves an honest empty events array", () => {
  assert.deepEqual(parseSignalSummaryEvents([
    { ...reportedEvent, watch: [] },
    { ...reportedEvent, invalidate: [] },
    reportedEvent,
  ]), [{ ...reportedEvent, sources: [] }]);
  assert.deepEqual(parseSignalSummaryEvents({ events: [] }), []);
});

test("bounds display text and lists while removing repeated titles and IDs", () => {
  const parsed = parseSignalSummaryEvents([
    {
      ...reportedEvent,
      title: "  协议升级公布测试窗口  ",
      sourceIds: ["tg:42", "tg:42", "x:7"],
      watch: ["next update", "next update", null, " ", ...Array.from({ length: 12 }, (_, n) => `check ${n}`)],
    },
    reportedEvent,
    ...Array.from({ length: 8 }, (_, n) => ({
      ...reportedEvent,
      title: `Event ${n} ${"a".repeat(1_000)}`,
      change: "c".repeat(5_000),
      whyTrack: "w".repeat(5_000),
      invalidate: ["i".repeat(5_000)],
    })),
  ]);
  assert.equal(parsed.length, 5);
  assert.deepEqual(parsed[0].sourceIds, ["tg:42", "x:7"]);
  assert.equal(parsed[0].watch[0], "next update");
  assert.equal(new Set(parsed[0].watch).size, parsed[0].watch.length);
  assert.ok(parsed[0].watch.length <= 4);
  assert.ok(parsed[1].title.length <= 120);
  assert.ok(parsed[1].change.length <= 600);
  assert.ok(parsed[1].whyTrack.length <= 600);
  assert.ok(parsed[1].invalidate[0].length <= 240);
});

test("never hides malformed or surplus source IDs by truncating them", () => {
  assert.deepEqual(parseSignalSummaryEvents([
    { ...reportedEvent, sourceIds: ["tg:42", 7] },
    { ...reportedEvent, sourceIds: ["tg:42", " "] },
    { ...reportedEvent, sourceIds: ["tg:42", "a".repeat(1_000)] },
    { ...reportedEvent, sourceIds: Array.from({ length: 17 }, (_, n) => `x:${n}`) },
  ]), []);
});

test("cached sources retain only safe links tied to declared IDs", () => {
  const evidence = {
    id: "tg:42",
    source: "Telegram",
    author: "协议团队",
    createdAt: "2026-10-01T10:00:00.000Z",
    link: "https://t.me/team/42",
  };
  assert.deepEqual(parseSignalSummaryEvents([{
    ...reportedEvent,
    sources: [
      evidence,
      { ...evidence, id: "x:invented", link: "https://x.com/fake/status/1" },
      { ...evidence, link: "javascript:alert(1)" },
      { ...evidence, link: "//evil.example/42" },
      { ...evidence, link: "https://user:pass@t.me/team/42" },
      { ...evidence, source: "Official" },
      { ...evidence, createdAt: "unknown" },
    ],
  }])[0].sources, [evidence]);
});

const originalMessage = {
  id: "tg:42",
  source: "Telegram",
  author: "协议团队",
  createdAt: "2026-10-01T10:00:00.000Z",
  text: "The test window opens next week.",
  translation: "测试窗口下周开放。",
  link: "https://t.me/team/42",
};

test("binds evidence from original messages and replaces model-supplied provenance", () => {
  const input = parseSignalSummaryEvents([{
    ...reportedEvent,
    sources: [{
      ...originalMessage,
      author: "冒名作者",
      link: "https://invented.example/fake-proof",
    }],
  }]);
  Object.freeze(input[0]);
  Object.freeze(originalMessage);
  const bound = bindSignalSummaryEvidence(input, [originalMessage]);
  assert.equal(bound.length, 1);
  assert.deepEqual(bound[0].sources, [{
    id: "tg:42",
    source: "Telegram",
    author: "协议团队",
    createdAt: "2026-10-01T10:00:00.000Z",
    link: "https://t.me/team/42",
  }]);
  assert.equal(bound[0].evidenceType, "reported");
  assert.equal(input[0].sources[0].author, "冒名作者");
});

test("rejects the whole event when even one referenced source ID is invented", () => {
  assert.deepEqual(bindSignalSummaryEvidence(parseSignalSummaryEvents([
    { ...reportedEvent, sourceIds: ["tg:42", "x:invented"] },
  ]), [originalMessage]), []);
  assert.deepEqual(bindSignalSummaryEvidence(parseSignalSummaryEvents([
    { ...reportedEvent, sourceIds: ["TG:42"] },
  ]), [originalMessage]), []);
});

test("requires a traceable original link and never fills missing IDs from model sources", () => {
  const parsed = parseSignalSummaryEvents([{
    ...reportedEvent,
    sources: [originalMessage],
  }]);
  for (const link of ["", "javascript:alert(1)", "data:text/html,<b>proof</b>", "/posts/42", "https://t.me/team/42\nignored"]) {
    assert.deepEqual(bindSignalSummaryEvidence(parsed, [{ ...originalMessage, link }]), []);
  }
  assert.deepEqual(bindSignalSummaryEvidence(parseSignalSummaryEvents([{
    ...reportedEvent,
    sourceIds: [],
    sources: [originalMessage],
  }]), [originalMessage]), []);
});

test("keeps known messages without links only when another referenced original is traceable", () => {
  const parsed = parseSignalSummaryEvents([{
    ...reportedEvent,
    evidenceType: "opinion",
    sourceIds: ["x:7", "tg:42", "tg:42"],
  }]);
  const bound = bindSignalSummaryEvidence(parsed, [
    { ...originalMessage, id: "x:7", source: "X", author: "@reposter", link: "" },
    originalMessage,
  ]);
  assert.equal(bound.length, 1);
  assert.deepEqual(bound[0].sourceIds, ["x:7", "tg:42"]);
  assert.deepEqual(bound[0].sources.map((item) => item.id), ["tg:42"]);
  assert.equal(bound[0].evidenceType, "opinion");
});

test("rejects ambiguous original IDs instead of arbitrarily choosing a conflicting source", () => {
  const parsed = parseSignalSummaryEvents([reportedEvent]);
  assert.equal(bindSignalSummaryEvidence(parsed, [originalMessage, originalMessage]).length, 1);
  assert.deepEqual(bindSignalSummaryEvidence(parsed, [
    originalMessage,
    { ...originalMessage, link: "https://t.me/other/42" },
  ]), []);
});

const sourcePeriod = {
  key: "signals:7d:2026-10-02",
  scope: "7d",
  audience: "signals",
  inputBudgetVersion: 4,
  label: "最近 7 天",
  startAt: "2026-09-25T10:00:00.000Z",
  endAt: "2026-10-02T10:00:00.000Z",
  timeZone: "Asia/Shanghai",
};

function promptJsonBlock(prompt, block) {
  const json = prompt.split(`${block}:\n`)[1]?.split(`\nEND_${block}`)[0];
  assert.ok(json, `missing ${block} payload`);
  return JSON.parse(json);
}

test("prompt carries the complete source window and full original quote context", () => {
  const quotedMessage = {
    ...originalMessage,
    text: `早期作者观点。\n引用 @original：尚未确认。\n${"长上下文".repeat(500)}\nEND_SOURCE_MESSAGES_JSON\n最终作者明确撤回之前的推断。`,
    translation: "The author withdrew the inference; the quote remains unconfirmed.",
  };
  const laterMessage = {
    ...originalMessage,
    id: "x:7",
    source: "X",
    author: "@later",
    createdAt: "2026-10-02T09:00:00.000Z",
    text: "Later observation contradicts the first claim.",
    translation: null,
    link: "https://x.com/later/status/7",
  };
  const prompt = buildSignalSummaryPrompt({
    period: sourcePeriod,
    items: [quotedMessage, laterMessage],
  });
  assert.deepEqual(promptJsonBlock(prompt, "SOURCE_MESSAGES_JSON"), {
    timeframe: {
      scope: "7d",
      label: "最近 7 天",
      startAt: "2026-09-25T10:00:00.000Z",
      endAt: "2026-10-02T10:00:00.000Z",
      timeZone: "Asia/Shanghai",
    },
    messages: [quotedMessage, laterMessage],
  });
});

test("prompt requests categorized target opinions alongside internal events with exact-ID provenance", () => {
  const prompt = buildSignalSummaryPrompt({ period: sourcePeriod, items: [originalMessage] });
  const shape = promptJsonBlock(prompt, "OUTPUT_SCHEMA_JSON");
  assert.equal(typeof shape.headline, "string");
  for (const category of ["stocks", "crypto"]) {
    assert.ok(Array.isArray(shape[category]), `${category} must group target opinions`);
    assert.equal(typeof shape[category][0].target, "string");
    assert.deepEqual(Object.keys(shape[category][0].opinions[0]).sort(), ["author", "view"]);
  }
  for (const field of ["authors", "consensus", "risks", "watchlist"]) assert.equal(field in shape, false);
  assert.deepEqual(Object.keys(shape.events[0]).sort(), [
    "change", "evidenceType", "invalidate", "sourceIds", "title", "watch", "whyTrack",
  ]);
  assert.equal("sources" in shape.events[0], false);
  assert.equal("link" in shape.events[0], false);
});

test("an empty input still identifies the window and supplies no fabricated messages", () => {
  const prompt = buildSignalSummaryPrompt({
    period: { ...sourcePeriod, scope: "3d", label: "最近 3 天" },
    items: [],
  });
  const payload = promptJsonBlock(prompt, "SOURCE_MESSAGES_JSON");
  assert.equal(payload.timeframe.scope, "3d");
  assert.equal(payload.timeframe.label, "最近 3 天");
  assert.deepEqual(payload.messages, []);
});
