import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");

assert.match(source, /<aside className="[^"]*lg:sticky[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:top-0[^"]*"/);
assert.match(source, /<aside className="[^"]*lg:h-screen[^"]*"/);
assert.match(source, /<form action="\/api\/logout" method="post"/);
assert.match(source, /type="submit"/);

assert.match(source, /data-mobile-command-shell/);
assert.match(source, /overflow-x-auto/);
assert.match(source, /fixed bottom-0/);
assert.match(source, /lg:hidden/);
assert.match(source, /pb-20 lg:pb-0/);
assert.match(source, /\{subtitle \? \(/);
assert.match(source, /router\.prefetch\("\/settings"\)/);
assert.match(source, /label: "抖音"/);
assert.match(source, /href: "\/douyin"/);
assert.match(source, /"douyin"/);
assert.match(source, /grid-cols-5/);
assert.doesNotMatch(source, /requestIdleCallback/);
assert.doesNotMatch(source, /warmFrequentRoutes/);
assert.match(source, /const \[pendingNav, setPendingNav\] = useState/);
assert.match(source, /pendingNav\?\.origin === activeNav \? pendingNav\.target : activeNav/);
assert.match(source, /setPendingNav\(\{ origin: activeNav, target \}\)/);
assert.match(source, /window\.clearTimeout\(pendingNavTimerRef\.current\)/);
assert.match(source, /window\.setTimeout\(\(\) => \{/);
assert.match(source, /setPendingNav\(null\)/);
assert.match(source, /NAV_PENDING_TIMEOUT_MS/);
assert.doesNotMatch(source, /setOptimisticActiveNav\(activeNav\)/);

console.log("ok - app shell mobile command layout");
