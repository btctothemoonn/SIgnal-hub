import assert from "node:assert/strict";
import { createSnapshotEventStream, closeSnapshotEventStreams } from "./snapshot-event-stream.ts";

let revision = "2026-09-05T00:00:00.000Z";
const cursors = [];
const abort = new AbortController();
const stream = createSnapshotEventStream({
  event: "snapshot", pollMs: 5, signal: abort.signal,
  getRevision: () => revision,
  getSnapshot: (since) => { cursors.push(since); return { since }; },
});
const reader = stream.getReader();
assert.match(new TextDecoder().decode((await reader.read()).value), /event: snapshot/);
assert.deepEqual(cursors, [null]);
revision = "2026-09-05T00:01:00.000Z";
assert.match(new TextDecoder().decode((await reader.read()).value), /00:00:00/);
assert.deepEqual(cursors, [null, "2026-09-05T00:00:00.000Z"]);
abort.abort();
assert.equal((await reader.read()).done, true);
const second = createSnapshotEventStream({ event: "test", pollMs: 5, getRevision: () => null, getSnapshot: () => ({}) }).getReader();
await second.read();
closeSnapshotEventStreams();
assert.equal((await second.read()).done, true, "shutdown must drain SSE streams");
console.log("ok - snapshot streams advance cursors and close on disconnect/shutdown");
