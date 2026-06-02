import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./signal-feed-floating-navigation.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /data-signal-feed-floating-navigation/);
assert.match(source, /aria-label=\{label\}/);
assert.match(source, /label="回到最新消息"/);
assert.match(source, /label="返回上次阅读"/);
assert.match(source, /label="跳到最早消息"/);
assert.match(source, /hidden lg:inline/);
assert.match(source, /newCount > 0/);
assert.match(source, /showLatest/);
assert.match(source, /onLatest/);
assert.match(source, /onSaved/);
assert.match(source, /onOldest/);

console.log("ok - signal feed floating navigation exposes responsive reading actions");
