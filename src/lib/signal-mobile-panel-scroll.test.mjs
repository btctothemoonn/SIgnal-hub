import assert from "node:assert/strict";
import { reduceSignalMobilePanelScroll } from "./signal-mobile-panel-scroll.ts";

const idleFeed = {
  activePanel: "feed",
  programmaticTarget: null,
};

assert.deepEqual(
  reduceSignalMobilePanelScroll(idleFeed, {
    type: "programmatic-start",
    target: "summary",
    clientWidth: 0,
  }),
  idleFeed,
  "an unmeasured pager does not create a false panel switch",
);

const summaryInFlight = {
  activePanel: "summary",
  programmaticTarget: "summary",
};

assert.deepEqual(
  reduceSignalMobilePanelScroll(summaryInFlight, {
    type: "programmatic-start",
    target: "feed",
    clientWidth: 0,
  }),
  summaryInFlight,
  "an unmeasured pager preserves the complete controller state",
);

let state = reduceSignalMobilePanelScroll(idleFeed, {
  type: "programmatic-start",
  target: "summary",
  clientWidth: 100,
});

assert.deepEqual(state, {
  activePanel: "summary",
  programmaticTarget: "summary",
});

state = reduceSignalMobilePanelScroll(state, {
  type: "scroll",
  scrollLeft: 25,
  clientWidth: 100,
});

assert.deepEqual(
  state,
  {
    activePanel: "summary",
    programmaticTarget: "summary",
  },
  "intermediate smooth-scroll events keep the requested summary panel active",
);

state = reduceSignalMobilePanelScroll(state, {
  type: "scroll",
  scrollLeft: 100,
  clientWidth: 100,
});

assert.deepEqual(
  state,
  {
    activePanel: "summary",
    programmaticTarget: null,
  },
  "arrival clears the programmatic target",
);

state = reduceSignalMobilePanelScroll(idleFeed, {
  type: "programmatic-start",
  target: "summary",
  clientWidth: 100,
});
state = reduceSignalMobilePanelScroll(state, { type: "user-interrupt" });
state = reduceSignalMobilePanelScroll(state, {
  type: "scroll",
  scrollLeft: 25,
  clientWidth: 100,
});

assert.deepEqual(
  state,
  {
    activePanel: "feed",
    programmaticTarget: null,
  },
  "user interruption returns panel selection to the scroll threshold",
);

state = reduceSignalMobilePanelScroll(summaryInFlight, {
  type: "programmatic-start",
  target: "feed",
  clientWidth: 100,
});
state = reduceSignalMobilePanelScroll(state, {
  type: "scroll",
  scrollLeft: 75,
  clientWidth: 100,
});

assert.deepEqual(state, {
  activePanel: "feed",
  programmaticTarget: "feed",
});

state = reduceSignalMobilePanelScroll(state, {
  type: "scroll",
  scrollLeft: 0,
  clientWidth: 100,
});

assert.deepEqual(
  state,
  {
    activePanel: "feed",
    programmaticTarget: null,
  },
  "a measured pager completes programmatic switching in both directions",
);

console.log("ok - mobile Signal panel scroll controller");
