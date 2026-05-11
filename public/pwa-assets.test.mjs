import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readPngSize(path) {
  const buffer = readFileSync(new URL(path, import.meta.url));
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

assert.deepEqual(readPngSize("./icon-192x192.png"), {
  width: 192,
  height: 192,
});
assert.deepEqual(readPngSize("./icon-512x512.png"), {
  width: 512,
  height: 512,
});
assert.deepEqual(readPngSize("./apple-touch-icon.png"), {
  width: 180,
  height: 180,
});

console.log("ok - pwa png assets");
