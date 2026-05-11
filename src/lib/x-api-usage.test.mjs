import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  authorizeXApiUsageToday,
  getXApiUsageSnapshot,
  reserveXApiPoints,
} from "./x-api-usage.ts";

const db = new DatabaseSync(":memory:");
const env = {
  X_DAILY_POINT_LIMIT: "2",
  X_API_USAGE_TIME_ZONE: "Asia/Shanghai",
};
const now = new Date("2026-04-30T05:00:00.000Z");

const first = reserveXApiPoints({
  db,
  env,
  now,
  kind: "tweet_by_id",
  detail: "first tweet",
});
assert.equal(first.allowed, true);
assert.equal(first.snapshot.pointsUsed, 1);
assert.equal(first.snapshot.blocked, false);

const second = reserveXApiPoints({
  db,
  env,
  now,
  kind: "tweet_by_id",
  detail: "second tweet",
});
assert.equal(second.allowed, true);
assert.equal(second.snapshot.pointsUsed, 2);
assert.equal(second.snapshot.blocked, true);

const blocked = reserveXApiPoints({
  db,
  env,
  now,
  kind: "tweet_by_id",
  detail: "third tweet",
});
assert.equal(blocked.allowed, false);
assert.equal(blocked.snapshot.pointsUsed, 2);
assert.equal(blocked.snapshot.blocked, true);

const authorized = authorizeXApiUsageToday({ db, env, now });
assert.equal(authorized.authorized, true);
assert.equal(authorized.blocked, false);

const afterAuthorization = reserveXApiPoints({
  db,
  env,
  now,
  kind: "tweet_by_id",
  detail: "third tweet",
});
assert.equal(afterAuthorization.allowed, true);
assert.equal(afterAuthorization.snapshot.pointsUsed, 3);
assert.equal(afterAuthorization.snapshot.authorized, true);

const snapshot = getXApiUsageSnapshot({ db, env, now });
assert.equal(snapshot.dateKey, "2026-04-30");
assert.equal(snapshot.limit, 2);
assert.equal(snapshot.pointsUsed, 3);

console.log("ok - x api usage guard blocks daily points until authorized");
