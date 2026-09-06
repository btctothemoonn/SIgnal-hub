import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalWecomSignature, verifyWecomSignature, readWecomBody } from "./wecom-signature.ts";
const vectors=JSON.parse(readFileSync(new URL("../../docs/integrations/wecom-summary/signature.example.json",import.meta.url),"utf8"));
for(const v of vectors.vectors){
 const env={WECOM_SYNC_ENABLED:"true",WECOM_SYNC_DEVICE_ID:v.device,WECOM_SYNC_SECRET:vectors.secret};
 const headers=new Headers({"content-type":"application/json","x-wecom-device":v.device,"x-wecom-timestamp":v.timestamp,"x-wecom-nonce":v.nonce,"x-wecom-signature":v.signature});
 const body=Buffer.from(v.body), now=Number(v.timestamp)*1000;
 assert.equal(createHmac("sha256",vectors.secret).update(canonicalWecomSignature(headers,body)).digest("hex"),v.signature);
 assert.deepEqual(verifyWecomSignature(headers,body,{env,now}),{ownerId:"admin",deviceId:v.device,nonce:v.nonce});
 assert.throws(()=>verifyWecomSignature(headers,Buffer.from(v.body+" "),{env,now}),e=>e.status===401);
 assert.throws(()=>verifyWecomSignature(headers,body,{env,now:now+301000}),e=>e.status===401);
 assert.throws(()=>verifyWecomSignature(headers,body,{env:{...env,WECOM_SYNC_ENABLED:"false"},now}),e=>e.status===503);
 assert.deepEqual(await readWecomBody(new Request("http://localhost/api/wecom/ingest",{method:"POST",headers,body})),body);
}
assert.throws(()=>verifyWecomSignature(new Headers(),Buffer.alloc(0)),e=>e.status===401);
await assert.rejects(()=>readWecomBody(new Request("http://localhost",{method:"POST",headers:{"content-type":"application/json"},body:"x".repeat(262145)})),e=>e.status===413);
await assert.rejects(()=>readWecomBody(new Request("http://localhost",{method:"POST",headers:{"content-type":"text/plain"},body:"x"})),e=>e.status===415);
console.log("ok - three WeCom HMAC vectors, body limits and disabled default");
