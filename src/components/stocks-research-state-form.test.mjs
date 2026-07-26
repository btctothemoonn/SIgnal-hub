import assert from "node:assert/strict";
import {
  beginResearchStateSave,
  createResearchStatePanelState,
  finishResearchStateSave,
  getResearchStatePanelMode,
  syncResearchStatePanelState,
  updateResearchStateForm,
} from "./stocks-research-state-form.ts";

function researchState(overrides = {}) {
  return {
    ticker: "NVDA",
    status: "watch",
    conviction: null,
    entryZone: "",
    invalidation: "",
    nextCatalyst: "",
    thesis: "",
    updatedAt: "2026-07-26T09:00:00.000Z",
    persisted: true,
    ...overrides,
  };
}

let panel = createResearchStatePanelState(researchState());
panel = updateResearchStateForm(panel, {
  status: "holding",
  conviction: 4,
  entryZone: "$180-$190",
  invalidation: "Breaks support",
  nextCatalyst: "Next earnings",
  thesis: "Demand remains strong",
});

const started = beginResearchStateSave(panel, false);
assert.ok(started.operation);
assert.deepEqual(started.operation.input, {
  ticker: "NVDA",
  status: "holding",
  conviction: 4,
  entryZone: "$180-$190",
  invalidation: "Breaks support",
  nextCatalyst: "Next earnings",
  thesis: "Demand remains strong",
});
assert.equal(beginResearchStateSave(started.state, false).operation, null);
assert.equal(beginResearchStateSave(panel, true).operation, null);

const parentUpdated = syncResearchStatePanelState(
  started.state,
  researchState({
    status: "holding",
    entryZone: "$181-$191",
    updatedAt: "2026-07-26T09:01:00.000Z",
  }),
);
assert.equal(parentUpdated.form.entryZone, "$181-$191");
assert.equal(parentUpdated.saving, true);

const saved = finishResearchStateSave(parentUpdated, started.operation.id, {
  ok: true,
});
assert.equal(saved.saveStatus, "saved");
assert.equal(saved.saving, false);

let rejectedDraft = createResearchStatePanelState(researchState());
rejectedDraft = updateResearchStateForm(rejectedDraft, {
  thesis: "Keep this local draft",
});
const rejectedStarted = beginResearchStateSave(rejectedDraft, false);
assert.ok(rejectedStarted.operation);
const rejected = finishResearchStateSave(
  rejectedStarted.state,
  rejectedStarted.operation.id,
  { ok: false, error: "Network unavailable" },
);
assert.equal(rejected.form.thesis, "Keep this local draft");
assert.equal(rejected.saveStatus, "error");
assert.equal(rejected.saveError, "Network unavailable");

const switchedTicker = syncResearchStatePanelState(
  saved,
  researchState({ ticker: "AMD", updatedAt: null, thesis: "AMD thesis" }),
);
assert.equal(switchedTicker.form.thesis, "AMD thesis");
assert.equal(switchedTicker.saveStatus, "idle");
assert.equal(switchedTicker.saveError, null);
assert.equal(switchedTicker.saving, false);

assert.equal(
  getResearchStatePanelMode({
    ticker: "NVDA",
    researchState: null,
    loading: false,
    hasSaveHandler: true,
  }),
  "unavailable",
);
assert.equal(
  getResearchStatePanelMode({
    ticker: "NVDA",
    researchState: null,
    loading: true,
    hasSaveHandler: true,
  }),
  "loading",
);
assert.equal(
  getResearchStatePanelMode({
    ticker: "NVDA",
    researchState: researchState(),
    loading: false,
    hasSaveHandler: false,
  }),
  "unavailable",
);
assert.equal(
  getResearchStatePanelMode({
    ticker: "NVDA",
    researchState: researchState(),
    loading: false,
    hasSaveHandler: true,
  }),
  "editor",
);
assert.equal(
  getResearchStatePanelMode({
    ticker: "AMD",
    researchState: researchState(),
    loading: false,
    hasSaveHandler: true,
  }),
  "unavailable",
);
assert.equal(
  getResearchStatePanelMode({
    ticker: "AMD",
    researchState: researchState(),
    loading: true,
    hasSaveHandler: true,
  }),
  "loading",
);

console.log("ok - stocks research state form transitions");
