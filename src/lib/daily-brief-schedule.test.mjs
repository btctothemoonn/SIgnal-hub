import assert from "node:assert/strict";

const dailyBrief = await import("./daily-investment-brief.ts");

assert.equal(
  typeof dailyBrief.getDailyBriefScheduleSlot,
  "function",
  "daily brief should expose the active Beijing schedule slot",
);

const { getDailyBriefScheduleSlot, isDailyBriefDue } = dailyBrief;

const midnightSlot = getDailyBriefScheduleSlot({
  now: new Date("2026-08-24T16:00:00.000Z"),
  env: {},
});
assert.deepEqual(midnightSlot, {
  dateKey: "2026-08-25",
  hour: 0,
  key: "2026-08-25@00",
  scheduledAt: "2026-08-24T16:00:00.000Z",
});

const morningSlot = getDailyBriefScheduleSlot({
  now: new Date("2026-08-25T00:00:00.000Z"),
  env: {},
});
assert.equal(morningSlot.key, "2026-08-25@08");

const afternoonSlot = getDailyBriefScheduleSlot({
  now: new Date("2026-08-25T08:00:00.000Z"),
  env: {},
});
assert.equal(afternoonSlot.key, "2026-08-25@16");

assert.equal(
  isDailyBriefDue({
    now: new Date("2026-08-24T23:59:00.000Z"),
    env: {},
    generatedAt: "2026-08-24T16:01:00.000Z",
  }),
  false,
  "the midnight slot should not rerun before 08:00 Beijing time",
);
assert.equal(
  isDailyBriefDue({
    now: new Date("2026-08-25T00:00:00.000Z"),
    env: {},
    generatedAt: "2026-08-24T16:01:00.000Z",
  }),
  true,
  "the 08:00 slot should run after the midnight edition",
);
assert.equal(
  isDailyBriefDue({
    now: new Date("2026-08-25T08:01:00.000Z"),
    env: {},
    generatedAt: "2026-08-25T08:00:30.000Z",
  }),
  false,
  "a successful 16:00 edition should fulfill that slot",
);

console.log("ok - daily brief Beijing schedule slots");
