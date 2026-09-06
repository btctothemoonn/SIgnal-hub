import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createWecomReceiver, forwardWecomIngest } from "./wecom-receiver.ts";
import { canonicalWecomSignature } from "./wecom-signature.ts";
const vectors=JSON.parse(readFileSync(new URL("../../docs/integrations/wecom-summary/signature.example.json",import.meta.url),"utf8"));
const dir=mkdtempSync(join(tmpdir(),"wecom-http-test-")), v=vectors.vectors[0];
const env={SIGNAL_HUB_RUNTIME_DIR:dir,WECOM_SYNC_ENABLED:"true",WECOM_SYNC_DEVICE_ID:v.device,WECOM_SYNC_SECRET:vectors.secret};
const now=Number(v.timestamp)*1000;
function request(body=v.body,nonce=randomBytes(16).toString("hex")) {
 const headers=new Headers({"content-type":"application/json","x-wecom-device":v.device,"x-wecom-timestamp":v.timestamp,"x-wecom-nonce":nonce});
 headers.set("x-wecom-signature",createHmac("sha256",vectors.secret).update(canonicalWecomSignature(headers,Buffer.from(body))).digest("hex"));
 return new Request("http://localhost/api/wecom/ingest",{method:"POST",headers,body});
}
const server=createWecomReceiver({env,now:()=>now});
try {
 server.listen(0,"127.0.0.1"); await once(server,"listening");
 env.WECOM_RECEIVER_PORT=String(server.address().port);
 const base=`http://127.0.0.1:${env.WECOM_RECEIVER_PORT}`;
 assert.deepEqual(await(await fetch(base+"/health")).json(),{ok:true});
 assert.equal((await fetch(base+"/api/wecom/ingest")).status,405);
 assert.equal((await fetch(base+"/api/wecom/ingest",{method:"POST",body:"{}"})).status,401);
 const oversized=request("x".repeat(262145));
 assert.equal((await fetch(base+"/api/wecom/ingest",{method:"POST",headers:oversized.headers,body:oversized.body,duplex:"half"})).status,413);
 const partial=async size=>new Promise((resolve,reject)=>{
  const client=httpRequest(base+"/api/wecom/ingest",{method:"POST",headers:Object.fromEntries(request().headers)},response=>{response.resume();response.once("end",()=>{client.destroy();resolve(response.statusCode);});});
  client.on("error",reject);client.setTimeout(6000,()=>client.destroy(new Error("synthetic upload timed out")));
  client.write("x".repeat(size));
 });
 assert.equal(await partial(262145),413,"oversized unfinished upload returns a bounded rejection");
 assert.equal(await partial(1),408,"slow unfinished upload returns a bounded timeout");
 const sensitive=JSON.parse(v.body); sensitive.report.summary="password=synthetic-private-value";
 const rejected=await forwardWecomIngest(request(JSON.stringify(sensitive)),{env,now}); assert.equal(rejected.status,400); assert.equal((await rejected.json()).error,"payload_sensitive");
 const first=request(); const copy=first.clone();
 const ack=await forwardWecomIngest(first,{env,now}); assert.equal(ack.status,200); assert.equal((await ack.json()).disposition,"stored");
 const replay=await forwardWecomIngest(copy,{env,now}); assert.equal(replay.status,409); assert.equal((await replay.json()).error,"replay");
 const duplicate=await forwardWecomIngest(request(),{env,now}); assert.equal((await duplicate.json()).disposition,"duplicate");
 const packet=JSON.parse(v.body); packet.report.id=packet.report.id.replace(v.device,"another-device");
 const other=await forwardWecomIngest(request(JSON.stringify(packet)),{env,now}); assert.equal(other.status,400);
 const conflict=JSON.parse(v.body); conflict.report.summary+=" changed";
 assert.equal((await forwardWecomIngest(request(JSON.stringify(conflict)),{env,now})).status,409);
 assert.equal((await forwardWecomIngest(request(),{env:{...env,WECOM_SYNC_ENABLED:"false"},now})).status,503);
 assert.equal((await forwardWecomIngest(request(),{env:{...env,WECOM_RECEIVER_PORT:"https://example.com"},now})).status,503);
 assert.equal((await forwardWecomIngest(request(),{env,now,fetchImpl:async()=>{throw new Error("private-details");}})).status,503);
 assert.equal((await forwardWecomIngest(request(),{env,now,fetchImpl:async()=>new Response("x".repeat(16385))})).status,503);
 console.log("ok - real loopback WeCom receiver, durable ACK, replay, duplicate, prefix and bounded forwarding");
} finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); rmSync(dir,{recursive:true,force:true});}
