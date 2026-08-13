import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./douyin-monitor-panel.tsx", import.meta.url), "utf8");

assert.match(source, /A股 \/ 板块 \/ 资产/);
assert.match(source, /为什么推荐 \/ 看好/);
assert.match(source, /炒作逻辑 \/ 催化/);
assert.match(source, /aria-label=\{`打开视频：\$\{video\.title\}`\}[\s\S]*<img/);
assert.match(source, /<h2[\s\S]*href=\{video\.videoUrl\}[\s\S]*\{video\.title\}/);

assert.match(source, /data-douyin-workspace/);
assert.match(source, /data-douyin-toolbar/);
assert.match(source, /data-douyin-video-list/);
assert.match(source, /data-douyin-video/);
assert.match(source, /data-douyin-load-more/);
assert.match(source, /snapshot\.pagination\?\.hasMore/);
assert.match(source, /loadedLimit \+ 10/);
assert.match(source, /limit=\$\{encodeURIComponent\(String\(limit\)\)\}/);
assert.match(source, /data-douyin-enabled-toggle/);
assert.match(source, /role="switch"/);
assert.match(source, /action: "douyin\.setEnabled"/);
assert.match(source, /data-douyin-paused-notice/);
assert.match(source, /!snapshot\.enabled/);
assert.match(source, /lg:grid-cols-\[minmax\(16rem,0\.34fr\)_minmax\(0,0\.66fr\)\]/);
assert.doesNotMatch(source, /rounded-2xl|rounded-3xl/);

console.log("ok - douyin monitor panel opens videos directly");
