import assert from "node:assert/strict";
import { packChartLabelPositions } from "./chart-label-layout.ts";

const packed = packChartLabelPositions(
  [
    { id: "GOOG", y: 101 },
    { id: "SNOW", y: 104 },
    { id: "AMZN", y: 111 },
    { id: "ORCL", y: 118 },
    { id: "PLTR", y: 124 },
    { id: "NOW", y: 170 },
  ],
  { minY: 34, maxY: 174, minGap: 22 },
);

const ordered = ["GOOG", "SNOW", "AMZN", "ORCL", "PLTR", "NOW"].map(
  (id) => packed[id],
);

for (let index = 1; index < ordered.length; index += 1) {
  assert.ok(
    ordered[index] - ordered[index - 1] >= 22,
    `label ${index} should not overlap the previous label`,
  );
}

assert.ok(Math.min(...ordered) >= 34);
assert.ok(Math.max(...ordered) <= 174);
assert.deepEqual(Object.keys(packed), ["GOOG", "SNOW", "AMZN", "ORCL", "PLTR", "NOW"]);

const bottomPacked = packChartLabelPositions(
  [
    { id: "A", y: 150 },
    { id: "B", y: 154 },
    { id: "C", y: 158 },
  ],
  { minY: 40, maxY: 170, minGap: 24 },
);

assert.equal(bottomPacked.C, 170);
assert.equal(bottomPacked.B, 146);
assert.equal(bottomPacked.A, 122);

console.log("ok - chart label layout avoids overlapping labels");
