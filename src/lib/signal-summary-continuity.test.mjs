import assert from "node:assert/strict";
import test from "node:test";
import { parseSignalSummaryEvents, bindSignalSummaryEvidence } from "./signal-summary-events.ts";

const continuityModule = await import("./signal-summary-continuity.ts").catch(() => null);
const period = { audience: "signals", scope: "12h" };
const firstAt = "2026-10-02T04:00:00.000Z";
const nextAt = "2026-10-02T05:00:00.000Z";
const source = (id, text = "Acme protocol testing opens next week.", createdAt = "2026-10-02T03:00:00.000Z") => ({
  id, text, createdAt, translation: null, source: "Telegram", author: "Acme team", link: `https://t.me/team/${id.split(":").at(-1)}`,
});
const anchor = source("tg:1");
const card = (overrides = {}) => ({
  title: "Acme protocol testing", change: "The team schedules protocol testing.",
  whyTrack: "Protocol testing results can affect deployment.", evidenceType: "reported",
  watch: ["Testing completes"], invalidate: ["Acme protocol testing is withdrawn"], sourceIds: ["tg:1"], sources: [],
  ...overrides,
});
function reconcile(events, items = [anchor], previous, generatedAt = firstAt, nextPeriod = period) {
  assert.ok(continuityModule, "event continuity implementation must be available");
  return continuityModule.reconcileSignalSummaryContinuity({ events, items, period: nextPeriod, previous, generatedAt });
}
function previous(result, generatedAt = firstAt, previousPeriod = period) {
  return { period: previousPeriod, generatedAt, summary: { events: result.events, eventHistory: result.eventHistory } };
}

// Removing server identity assignment would silently make every round look new.
test("first cards receive server identity and paraphrases with a shared original continue it", () => {
  const first = reconcile([card()]);
  assert.equal(first.events[0].tracking.state, "new");
  assert.equal(first.events[0].tracking.firstSeenAt, firstAt);
  const next = reconcile([card({ title: "Acme protocol testing schedule", change: "A differently worded recap." })], [anchor], previous(first), nextAt);
  assert.equal(next.events[0].tracking.id, first.events[0].tracking.id);
  assert.equal(next.events[0].tracking.state, "continuing");
  assert.equal(next.events[0].tracking.lastChangedAt, firstAt);
  assert.equal(next.events[0].tracking.lastSeenAt, nextAt);
  assert.equal(next.events[0].tracking.previousGeneratedAt, firstAt);
});

test("a different topic at the same company does not inherit the old identity", () => {
  const first = reconcile([card()]);
  for (const title of ["Acme quarterly revenue", "Acme protocol grant distribution"]) {
    const next = reconcile([card({ title, change: "Another subject.", previousEventId: first.events[0].tracking.id })], [anchor], previous(first), nextAt);
    assert.equal(next.events[0].tracking.state, "new", title);
    assert.notEqual(next.events[0].tracking.id, first.events[0].tracking.id);
  }
});

test("a shared company and generic Chinese protocol name do not merge unrelated topics", () => {
  const original = source("tg:1", "Acme 协议测试与 Acme 协议空投是两个独立主题。");
  const first = reconcile([card({ title: "Acme 协议测试" })], [original]);
  for (const previousEventId of [undefined, first.events[0].tracking.id]) {
    const next = reconcile([card({ title: "Acme 协议空投", previousEventId })], [original], previous(first), nextAt);
    assert.equal(next.events[0].tracking.state, "new");
    assert.notEqual(next.events[0].tracking.id, first.events[0].tracking.id);
  }
});

test("a verified milestone carries its earlier originals and appears ahead of continuing cards", () => {
  const other = source("tg:2", "Beta validator network enters testing.");
  const first = reconcile([card(), card({ title: "Beta validator network", sourceIds: ["tg:2"] })], [anchor, other]);
  const update = source("tg:3", "Acme protocol testing completed stage two successfully.", "2026-10-02T04:30:00.000Z");
  const next = reconcile([
    card({ title: "Beta validator network", sourceIds: ["tg:2"] }),
    card({ title: "Acme protocol testing results", sourceIds: ["tg:3"], previousEventId: first.events[0].tracking.id,
      progressProof: { kind: "progress", sourceId: "tg:3", quote: update.text, reason: "Stage two completed." } }),
  ], [other, update], previous(first), nextAt);
  assert.deepEqual(next.events.map((event) => event.tracking.state), ["updated", "continuing"]);
  assert.equal(next.events[0].tracking.lastChangedAt, nextAt);
  assert.deepEqual(next.events[0].sourceIds, ["tg:3", "tg:1"]);
  assert.deepEqual(next.events[0].sources.map((entry) => entry.link), ["https://t.me/team/3", "https://t.me/team/1"]);
  assert.deepEqual(next.events[0].tracking.newSourceIds, ["tg:3"]);
  assert.ok(next.events[0].tracking.note.includes(update.text), "the verified original quote makes the actual progress visible");
  assert.equal(next.events[0].tracking.note.includes("Stage two completed."), false, "the model's reason is not promoted to a verified source statement");
});

test("additional coverage, old quotes, unknown proof sources and verbatim reposts do not upgrade a card", () => {
  const first = reconcile([card()]);
  const id = first.events[0].tracking.id;
  const fixtures = [
    { item: source("tg:3", "Acme protocol testing receives more coverage.", "2026-10-02T04:30:00.000Z") },
    { item: source("tg:3", "Acme protocol testing completed stage two.", "2026-10-02T02:00:00.000Z"), proof: true },
    { item: source("tg:3", "Acme protocol testing completed stage two.", "2026-10-02T04:30:00.000Z"), proof: true, quote: "Invented approval quote" },
    { item: source("tg:3", "Acme protocol testing completed stage two.", "2026-10-02T04:30:00.000Z"), proof: true, sourceId: "tg:unknown" },
    { item: source("tg:3", anchor.text, "2026-10-02T04:30:00.000Z"), proof: true },
    { item: source("tg:3", "Repost: Acme protocol testing completed stage two last month.", "2026-10-02T04:30:00.000Z"), proof: true },
  ];
  for (const fixture of fixtures) {
    const next = reconcile([card({ sourceIds: [fixture.item.id], previousEventId: id,
      ...(fixture.proof ? { progressProof: { kind: "progress", sourceId: fixture.sourceId ?? fixture.item.id, quote: fixture.quote ?? fixture.item.text, reason: "A claim" } } : {}),
    })], [fixture.item], previous(first), nextAt);
    assert.equal(next.events[0].tracking.state, "continuing", fixture.item.text);
  }
});

test("only a new exact source reversal can invalidate a known event, and an old repost cannot reactivate it", () => {
  const first = reconcile([card()]);
  const reversal = source("tg:4", "Acme protocol testing is withdrawn; the earlier testing schedule was retracted.", "2026-10-02T04:30:00.000Z");
  const nextCard = card({ sourceIds: ["tg:4"], previousEventId: first.events[0].tracking.id,
    progressProof: { kind: "invalidation", sourceId: "tg:4", quote: reversal.text, reason: "Testing schedule was withdrawn." } });
  const closed = reconcile([nextCard], [reversal], previous(first), nextAt);
  assert.equal(closed.events[0].tracking.state, "invalidated");
  assert.ok(closed.events[0].tracking.note.includes(reversal.text));
  assert.match(closed.events[0].tracking.note, /来源|核实|确认/);
  const replay = reconcile([card()], [anchor], previous(closed, nextAt), "2026-10-02T06:00:00.000Z");
  assert.equal(replay.events[0].tracking.id, first.events[0].tracking.id);
  assert.equal(replay.events[0].tracking.state, "invalidated");
  for (const item of [
    source("tg:4", reversal.text, "2026-10-02T02:00:00.000Z"),
    source("tg:4", "Acme protocol testing completed stage two.", "2026-10-02T04:30:00.000Z"),
    source("tg:4", "Acme payroll report was withdrawn; protocol testing continues.", "2026-10-02T04:30:00.000Z"),
  ]) {
    const attempted = reconcile([{ ...nextCard, progressProof: { ...nextCard.progressProof, quote: item.text } }], [item], previous(first), nextAt);
    assert.equal(attempted.events[0].tracking.state, "continuing", item.text);
  }
});

test("missing cards stay in history and later reappearance keeps their original identity", () => {
  const first = reconcile([card()]);
  const omitted = reconcile([], [source("tg:5", "Another event")], previous(first), nextAt);
  assert.equal(omitted.events.length, 0);
  assert.equal(omitted.eventHistory[0].tracking.state, "new");
  assert.equal(omitted.eventHistory[0].tracking.lastSeenAt, firstAt);
  const back = reconcile([card()], [anchor], previous(omitted, nextAt), "2026-10-02T06:00:00.000Z");
  assert.equal(back.events[0].tracking.id, first.events[0].tracking.id);
  assert.equal(back.events[0].tracking.state, "continuing");
});

test("unknown or ambiguous references cannot hijack history or match the same event twice", () => {
  const first = reconcile([card()]);
  const unknown = reconcile([card({ previousEventId: "invented:event" })], [anchor], previous(first), nextAt);
  assert.equal(unknown.events[0].tracking.state, "new");
  assert.notEqual(unknown.events[0].tracking.id, first.events[0].tracking.id);
  const duplicate = reconcile([
    card({ title: "Acme protocol testing stage two", previousEventId: first.events[0].tracking.id }),
    card({ title: "Acme protocol testing stage three", previousEventId: first.events[0].tracking.id }),
  ], [anchor], previous(first), nextAt);
  assert.deepEqual(duplicate.events.map((event) => event.tracking.state), ["new", "new"]);
  assert.notEqual(duplicate.events[0].tracking.id, duplicate.events[1].tracking.id);
});

test("scope and audience boundaries reset identities and ignore previous history", () => {
  const first = reconcile([card()]);
  const next = reconcile([card()], [anchor], previous(first), nextAt, { ...period, scope: "today" });
  assert.equal(next.events[0].tracking.state, "new");
  assert.notEqual(next.events[0].tracking.id, first.events[0].tracking.id);
  assert.equal(next.eventHistory.length, 1);
  const wrongAudience = reconcile([card()], [anchor], previous(first, firstAt, { ...period, audience: "stocks" }), nextAt);
  assert.equal(wrongAudience.events[0].tracking.state, "new");
});

test("continuity ignores injected model identity, history and previous provenance", () => {
  const first = reconcile([card({ tracking: { id: "stolen", state: "invalidated" }, sources: [{ ...anchor, link: "https://fake.example" }] })]);
  assert.notEqual(first.events[0].tracking.id, "stolen");
  assert.equal(first.events[0].tracking.state, "new");
  assert.equal(first.events[0].sources[0].link, "https://t.me/team/1");
  assert.equal("previousEventId" in first.events[0], false);
  const attempted = reconcile([card({ sourceIds: ["tg:1", "invented:1"] })]);
  assert.equal(attempted.events.length, 0);
});

test("cached tracking survives normalization while generation binding strips it", () => {
  const tracking = { id: "signal:12h:fixture", state: "continuing", firstSeenAt: firstAt, lastSeenAt: nextAt,
    lastChangedAt: firstAt, previousGeneratedAt: firstAt, newSourceIds: [], note: "继续观察" };
  const parsed = parseSignalSummaryEvents([card({ tracking })]);
  assert.deepEqual(parsed[0].tracking, tracking);
  assert.equal(bindSignalSummaryEvidence(parsed, [anchor])[0].tracking, undefined);
  assert.equal(parseSignalSummaryEvents([card({ tracking: { ...tracking, firstSeenAt: "invalid" } })])[0].tracking, undefined);
});

test("negated, hypothetical or source-disputed quotes never advance or close an event", () => {
  const first = reconcile([card()]);
  const fixtures = [
    { kind: "invalidation", text: "Acme protocol testing has NOT been withdrawn." },
    { kind: "invalidation", text: "Acme protocol testing could be cancelled." },
    { kind: "invalidation", text: "Acme protocol testing was previously withdrawn." },
    { kind: "invalidation", text: "Acme protocol testing date was corrected to Friday." },
    { kind: "invalidation", text: 'The rumor "Acme protocol testing is withdrawn" is false.', quote: "Acme protocol testing is withdrawn" },
    { kind: "progress", text: 'The claim "Acme protocol testing completed stage two" is false.', quote: "Acme protocol testing completed stage two" },
    { kind: "progress", text: "Acme protocol testing was never completed." },
    { kind: "progress", text: "Acme protocol testing may be completed tomorrow." },
    { kind: "progress", text: "Acme protocol testing remains unchanged after an approved report." },
  ];
  for (const fixture of fixtures) {
    const item = source("tg:9", fixture.text, "2026-10-02T04:30:00.000Z");
    const next = reconcile([card({ sourceIds: [item.id], previousEventId: first.events[0].tracking.id,
      progressProof: { kind: fixture.kind, sourceId: item.id, quote: fixture.quote ?? item.text, reason: "A source claim" },
    })], [item], previous(first), nextAt);
    assert.equal(next.events[0].tracking.state, "continuing", fixture.text);
  }
});

test("denial of a cancellation or withdrawal report does not invalidate the event", () => {
  const englishFirst = reconcile([card()]);
  const chineseCard = card({ title: "Acme 协议测试安排", invalidate: ["Acme 协议测试安排被取消或撤回"] });
  const chineseFirst = reconcile([chineseCard]);
  const fixtures = [
    { first: englishFirst, event: card(), text: "Acme protocol testing cancellation was denied; testing continues on Friday." },
    { first: englishFirst, event: card(), text: "Acme protocol testing withdrawal reports were refuted by the team." },
    { first: englishFirst, event: card(), text: "Acme protocol testing cancellation reports were retracted by the author." },
    { first: englishFirst, event: card(), text: 'The claim "Acme protocol testing is withdrawn" was denied.', quote: "Acme protocol testing is withdrawn" },
    { first: chineseFirst, event: chineseCard, text: "Acme 协议测试安排取消消息被否认，测试仍将继续。" },
    { first: chineseFirst, event: chineseCard, text: "Acme 协议测试安排撤回消息已辟谣，原安排继续。" },
  ];
  for (const fixture of fixtures) {
    const item = source("tg:9", fixture.text, "2026-10-02T04:30:00.000Z");
    const next = reconcile([{ ...fixture.event, sourceIds: [item.id], previousEventId: fixture.first.events[0].tracking.id,
      progressProof: { kind: "invalidation", sourceId: item.id, quote: fixture.quote ?? item.text, reason: "Model claims invalidation." },
    }], [item], previous(fixture.first), nextAt);
    assert.equal(next.events[0].tracking.state, "continuing", fixture.text);
    assert.equal(next.events[0].tracking.lastChangedAt, firstAt);
  }
});

test("denying an unrelated claim cannot satisfy a withdrawal or cancellation condition", () => {
  const chineseCard = card({ title: "Acme 协议测试安排", invalidate: ["Acme 协议测试安排被取消"] });
  const fixtures = [
    { event: card(), text: "Acme protocol testing team denied safety violations during the rehearsal." },
    { event: card(), text: "Acme protocol testing team refuted safety reports during the rehearsal." },
    { event: card(), text: "Acme protocol testing results were denied by a commentator." },
    { event: card({ invalidate: ["Acme protocol testing approval is revoked"] }), text: "Acme protocol testing team denied safety violations during the rehearsal." },
    { event: chineseCard, text: "Acme 协议测试安排团队否认演练存在安全问题。" },
  ];
  for (const fixture of fixtures) {
    const first = reconcile([fixture.event]);
    const item = source("tg:9", fixture.text, "2026-10-02T04:30:00.000Z");
    const next = reconcile([{ ...fixture.event, sourceIds: [item.id], previousEventId: first.events[0].tracking.id,
      progressProof: { kind: "invalidation", sourceId: item.id, quote: item.text, reason: "Model claims this ends the event." },
    }], [item], previous(first), nextAt);
    assert.equal(next.events[0].tracking.state, "continuing", fixture.text);
    assert.equal(next.events[0].tracking.lastChangedAt, firstAt);
  }
});

test("progress requires its own traceable original and ignores a reused canonical link", () => {
  const first = reconcile([card()]);
  for (const link of ["", anchor.link]) {
    const update = { ...source("tg:9", "Acme protocol testing completed stage two.", "2026-10-02T04:30:00.000Z"), link };
    const next = reconcile([card({ sourceIds: ["tg:1", "tg:9"], previousEventId: first.events[0].tracking.id,
      progressProof: { kind: "progress", sourceId: "tg:9", quote: update.text, reason: "Completed stage two." },
    })], [anchor, update], previous(first), nextAt);
    assert.equal(next.events[0].tracking.state, "continuing", link);
  }
});

test("a later verbatim new-ID copy cannot manufacture progress after the old source leaves selection", () => {
  const text = "Acme protocol testing completed stage two successfully.";
  const first = reconcile([card()], [source("tg:1", text)]);
  const copy = source("tg:9", text, "2026-10-02T04:30:00.000Z");
  const next = reconcile([card({ sourceIds: [copy.id], previousEventId: first.events[0].tracking.id,
    progressProof: { kind: "progress", sourceId: copy.id, quote: text, reason: "Completed testing." },
  })], [copy], previous(first), nextAt);
  assert.equal(next.events[0].tracking.state, "continuing");
});

test("all sixteen bilingual originals retain fingerprints that prevent late new-ID reposts", () => {
  const originals = Array.from({ length: 16 }, (_, index) => ({
    ...source(`tg:${index + 20}`, `Acme protocol testing completed stage ${index + 1} successfully.`),
    translation: `Acme 协议测试第 ${index + 1} 阶段已完成。`,
  }));
  const first = reconcile([card({ sourceIds: originals.map((item) => item.id) })], originals);
  const copy = { ...originals[8], id: "tg:99", link: "https://t.me/team/99", createdAt: "2026-10-02T04:30:00.000Z" };
  const next = reconcile([card({ sourceIds: [copy.id], previousEventId: first.events[0].tracking.id,
    progressProof: { kind: "progress", sourceId: copy.id, quote: copy.text, reason: "The ninth milestone completed." },
  })], [copy], previous(first), nextAt);
  assert.equal(next.events[0].tracking.state, "continuing", "the ninth original's body must remain known when originals are absent");
  assert.equal(first.events[0].tracking.evidenceDigests.length, 32);
  assert.equal(parseSignalSummaryEvents(first.events)[0].tracking.evidenceDigests.length, 32);
  assert.ok(next.events[0].tracking.evidenceDigests.length <= 32);
});

test("retained source fingerprints follow final source IDs across differently ordered rounds", () => {
  const originals = Array.from({ length: 16 }, (_, index) => ({
    ...source(`tg:${index + 1}`, `Acme protocol testing completed stage ${index + 1} successfully.`),
    translation: `Acme 协议测试第 ${index + 1} 阶段已完成。`,
  }));
  const first = reconcile([card({ sourceIds: originals.map((item) => item.id).reverse() })], originals);
  const checkIn = { ...source("tg:17", "Acme protocol testing receives routine coverage.", "2026-10-02T04:20:00.000Z"), translation: "Acme 协议测试收到例行报道。" };
  const second = reconcile([card({ sourceIds: [checkIn.id], previousEventId: first.events[0].tracking.id })], [checkIn], previous(first), nextAt);
  assert.deepEqual(second.events[0].sourceIds, ["tg:17", "tg:16", "tg:15", "tg:14", "tg:13", "tg:12", "tg:11", "tg:10", "tg:9", "tg:8", "tg:7", "tg:6", "tg:5", "tg:4", "tg:3", "tg:2"]);
  const copy = { ...originals[15], id: "tg:99", link: "https://t.me/team/99", createdAt: "2026-10-02T04:30:00.000Z" };
  const third = reconcile([card({ sourceIds: [copy.id], previousEventId: second.events[0].tracking.id,
    progressProof: { kind: "progress", sourceId: copy.id, quote: copy.text, reason: "The sixteenth milestone is claimed as new." },
  })], [copy], previous(second, nextAt), "2026-10-02T06:00:00.000Z");
  assert.equal(third.events[0].tracking.state, "continuing", "the still-retained sixteenth original must keep both fingerprints");
  const cached = parseSignalSummaryEvents(second.events)[0];
  assert.deepEqual(Object.keys(cached.tracking.evidenceDigestsBySource), second.events[0].sourceIds);
  assert.equal(cached.tracking.evidenceDigestsBySource["tg:16"].length, 2);
  assert.equal(cached.tracking.evidenceDigestsBySource["tg:1"], undefined);
});

test("flat-only legacy fingerprints cannot establish fresh progress when old bodies are unavailable", () => {
  const first = reconcile([card()]);
  delete first.events[0].tracking.evidenceDigestsBySource;
  const legacy = previous(first);
  const update = source("tg:9", "Acme protocol testing completed a new stage successfully.", "2026-10-02T04:30:00.000Z");
  const candidate = card({ sourceIds: [update.id], previousEventId: first.events[0].tracking.id,
    progressProof: { kind: "progress", sourceId: update.id, quote: update.text, reason: "A stage completed." },
  });
  const uncertain = reconcile([candidate], [update], legacy, nextAt);
  assert.equal(uncertain.events[0].tracking.state, "continuing");
  const originalsAvailable = reconcile([candidate], [anchor, update], legacy, nextAt);
  assert.equal(originalsAvailable.events[0].tracking.state, "updated", "current supplied old originals can establish associated fingerprints");
});

test("a new body prefix cannot make an exact old original quote into progress", () => {
  const text = "Acme protocol testing completed stage two successfully.";
  const first = reconcile([card({ change: "Second-stage test results are available." })], [source("tg:1", text)]);
  const repackaged = source("tg:9", `Latest report: ${text}`, "2026-10-02T04:30:00.000Z");
  const next = reconcile([card({ sourceIds: [repackaged.id], previousEventId: first.events[0].tracking.id,
    progressProof: { kind: "progress", sourceId: repackaged.id, quote: text, reason: "Testing completion is claimed as new." },
  })], [repackaged], previous(first), nextAt);
  assert.equal(next.events[0].tracking.state, "continuing");
  assert.equal(next.events[0].tracking.lastChangedAt, firstAt);
});

test("current original metadata takes priority over older cached metadata for the same ID", () => {
  const first = reconcile([card()]);
  const changedOriginal = { ...anchor, author: "Updated channel title", link: "https://t.me/current/1" };
  const next = reconcile([card()], [changedOriginal], previous(first), nextAt);
  assert.equal(next.events[0].sources[0].author, "Updated channel title");
  assert.equal(next.events[0].sources[0].link, "https://t.me/current/1");
});

test("conflicting current bodies under one original ID cannot provide event evidence", () => {
  const first = reconcile([card()]);
  const item = source("tg:9", "Acme protocol testing completed stage two.", "2026-10-02T04:30:00.000Z");
  const next = reconcile([card({ sourceIds: [item.id], previousEventId: first.events[0].tracking.id,
    progressProof: { kind: "progress", sourceId: item.id, quote: item.text, reason: "Testing completed." },
  })], [item, { ...item, text: "Acme protocol testing has not completed." }], previous(first), nextAt);
  assert.equal(next.events.length, 0);
  assert.equal(next.eventHistory[0].tracking.state, "new");
});

test("history and retained source evidence remain bounded across successful rounds", () => {
  let prior;
  let latest;
  for (let index = 0; index < 14; index += 1) {
    const item = source(`tg:${index + 10}`, `Topic${index} independent research announcement.`);
    latest = reconcile([card({ title: `Topic${index} independent research`, sourceIds: [item.id] })], [item], prior, nextAt);
    prior = previous(latest, nextAt);
  }
  assert.equal(latest.eventHistory.length, 10);
  let many = reconcile([card()]);
  for (let index = 2; index < 22; index += 1) {
    const item = source(`tg:${index}`, `Acme protocol testing received coverage number ${index}.`, `2026-10-02T04:${String(index).padStart(2, "0")}:00.000Z`);
    many = reconcile([card({ sourceIds: [item.id], previousEventId: many.events[0].tracking.id })], [item], previous(many), nextAt);
  }
  assert.equal(many.events[0].sources.length, 16);
  assert.equal(many.events[0].sourceIds.length, 16);
});
