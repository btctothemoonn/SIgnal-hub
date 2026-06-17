import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  getXHybridTweetFetchDecision,
  markXHybridTweetFetch,
  initXPipelineDb,
} from "./x-pipeline-store.ts";

const db = new DatabaseSync(":memory:");
initXPipelineDb(db);

assert.deepEqual(
  getXHybridTweetFetchDecision("1", { db, now: new Date("2026-06-17T00:00:00.000Z") }),
  {
    allowed: true,
    reason: "no-history",
    state: null,
  },
);

markXHybridTweetFetch(
  {
    tweetId: "1",
    status: "success",
    detail: "full tweet",
    fetchedAt: "2026-06-17T00:00:00.000Z",
  },
  db,
);
assert.equal(
  getXHybridTweetFetchDecision("1", {
    db,
    now: new Date("2026-06-17T01:00:00.000Z"),
    successCooldownMs: 6 * 60 * 60_000,
  }).allowed,
  false,
);

markXHybridTweetFetch(
  {
    tweetId: "2",
    status: "low_quality",
    detail: "quoted incomplete",
    fetchedAt: "2026-06-17T00:00:00.000Z",
  },
  db,
);
assert.deepEqual(
  getXHybridTweetFetchDecision("2", {
    db,
    now: new Date("2026-06-17T01:00:00.000Z"),
    lowQualityCooldownMs: 6 * 60 * 60_000,
  }),
  {
    allowed: false,
    reason: "low-quality-cooldown",
    state: {
      tweetId: "2",
      status: "low_quality",
      detail: "quoted incomplete",
      fetchedAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
    },
  },
);

assert.equal(
  getXHybridTweetFetchDecision("2", {
    db,
    now: new Date("2026-06-17T07:00:00.000Z"),
    lowQualityCooldownMs: 6 * 60 * 60_000,
  }).allowed,
  true,
);

console.log("ok - x hybrid tweet fetch state applies shared cooldowns");
