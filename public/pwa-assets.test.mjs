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

// Next.js' ICO decoder requires embedded PNG frames to have an RGBA color type.
const favicon = readFileSync(new URL("../src/app/favicon.ico", import.meta.url));
assert.equal(favicon.readUInt16LE(2), 1, "favicon must be an ICO image");
for (let index = 0; index < favicon.readUInt16LE(4); index += 1) {
  const entry = 6 + index * 16;
  const offset = favicon.readUInt32LE(entry + 12);
  const frame = favicon.subarray(offset, offset + favicon.readUInt32LE(entry + 8));
  if (frame.subarray(1, 4).toString() === "PNG") {
    assert.equal(frame[25], 6, "ICO PNG frames must be RGBA for Next.js decoding");
  }
}

console.log("ok - pwa png assets and Next.js-compatible favicon");
