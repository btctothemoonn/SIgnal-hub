import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./alpha-summary-card.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /const pollTimer = window\.setInterval/);
assert.doesNotMatch(source, /const generateTimer = window\.setInterval/);
assert.match(source, /method: force \? "POST" : "GET"/);
assert.match(source, /onClick=\{\(\) => void loadSummary\(true, scope\)\}/);
assert.doesNotMatch(source, /<AlphaSummaryScopeResult[\s\S]*?key=\{scope\}/);
assert.match(source, /<AlphaSummaryScopeResult[\s\S]*?scope=\{scope\}/);
assert.match(source, /const \[snapshotRecord, setSnapshotRecord\] = useState<\{\s*scope: AlphaSummaryScope;\s*snapshot: AlphaSummarySnapshot;/);
assert.match(source, /const \[busyScope, setBusyScope\] = useState<AlphaSummaryScope \| null>\(null\)/);
assert.match(source, /const \[manualMessageRecord, setManualMessageRecord\] = useState<\{\s*scope: AlphaSummaryScope;\s*message: string;/);
assert.match(source, /const requestsInFlight = useRef<Set<AlphaSummaryScope>>\(new Set\(\)\)/);
assert.match(source, /const abortControllers = useRef<Map<AlphaSummaryScope, Set<AbortController>>>\(\s*new Map\(\),?\s*\)/);
assert.match(source, /snapshotRecord\?\.scope === scope \? snapshotRecord\.snapshot : null/);
assert.match(source, /manualMessageRecord\?\.scope === scope \? manualMessageRecord\.message : null/);
assert.match(source, /if \(!controller\.signal\.aborted && scope === targetScope\)/);
assert.doesNotMatch(source, /setSnapshotRecord\(null\)/);
assert.doesNotMatch(source, /setManualMessageRecord\(null\)/);
assert.doesNotMatch(source, /setSnapshot\(null\)/);
assert.match(source, /const manualProgressMessage = `正在重新生成\$\{targetScopeConfig\.label\}总结\.\.\.`/);
assert.match(source, /message: manualProgressMessage/);
assert.match(
  source,
  /if \(error instanceof DOMException && error\.name === "AbortError"\) \{\s*if \(force\) \{\s*setManualMessageRecord\(\(current\) =>\s*current\?\.scope === targetScope &&\s*current\.message === manualProgressMessage\s*\? null\s*: current,\s*\);\s*\}\s*return;\s*\}/,
);
assert.match(source, /if \(force && !controller\.signal\.aborted\) \{/);
assert.match(source, /new AbortController\(\)/);
assert.match(source, /signal: controller\.signal/);
assert.match(source, /controller\.abort\(\)/);
assert.match(source, /error instanceof DOMException && error\.name === "AbortError"/);

console.log("ok - browser polls summaries without scheduled force generation");
