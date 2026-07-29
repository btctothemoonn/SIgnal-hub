import assert from "node:assert/strict";
import { reduceSignalMobilePanelScroll } from "./signal-mobile-panel-scroll.ts";

const idleFeed = {
  activePanel: "feed",
  programmaticTarget: null,
};

let state = reduceSignalMobilePanelScroll(idleFeed, {
  type: "programmatic-start",
  target: "summary",
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

console.log("ok - mobile Signal panel scroll controller");
