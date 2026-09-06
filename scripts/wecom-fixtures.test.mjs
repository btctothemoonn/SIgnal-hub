import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const base=new URL("../docs/integrations/wecom-summary/",import.meta.url);
const archive=new URL("history/8f6df4f/",base);
const manifest=JSON.parse(readFileSync(new URL("manifest.json",archive),"utf8"));
for(const [name,expected] of Object.entries(manifest.files)) {
 const body=readFileSync(new URL(name,archive));
 assert.equal(createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex"),expected,name);
}
const vectors=JSON.parse(readFileSync(new URL("signature.example.json",base),"utf8"));
const report=vectors.vectors.find(v=>JSON.parse(v.body).type==="report");
assert.equal(createHash("sha256").update(report.body).digest("hex"),"8e5ce95444e2cccc6ab02823d57b79796b9dc3a5e7d022ef322ce4470ae95bee");
for(const vector of vectors.vectors) {
 const packet=JSON.parse(vector.body);
 const name={report:"report",ca_alert:"ca-alert",heartbeat:"heartbeat"}[packet.type];
 assert.deepEqual(JSON.parse(readFileSync(new URL(`${name}.example.json`,base),"utf8")),packet);
}
const card=JSON.parse(report.body).report.caDiscussions[0];
assert.deepEqual([card.uniqueStatementCount,card.duplicateCount],[2,0]);
console.log("ok - immutable seven-file historical manifest and Mac corrected 2/0 candidate SHA256");
