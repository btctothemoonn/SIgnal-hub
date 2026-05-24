import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./douyin-monitor-panel.tsx", import.meta.url), "utf8");

assert.match(source, /A股 \/ 板块 \/ 资产/);
assert.match(source, /炒作逻辑 \/ 催化/);
assert.match(source, /aria-label=\{`打开视频：\$\{video\.title\}`\}[\s\S]*<img/);
assert.match(source, /<h2[\s\S]*href=\{video\.videoUrl\}[\s\S]*\{video\.title\}/);

console.log("ok - douyin monitor panel opens videos directly");
