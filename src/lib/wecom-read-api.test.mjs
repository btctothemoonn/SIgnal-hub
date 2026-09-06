import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "./admin-auth.ts";
import { handleWecomRead } from "./wecom-read-api.ts";
const dir=mkdtempSync(join(tmpdir(),"wecom-read-test-"));
const env={SIGNAL_HUB_RUNTIME_DIR:dir,ADMIN_PASSWORD:"synthetic-only",ADMIN_SESSION_SECRET:"synthetic-session-secret-not-production",WECOM_OWNER_ADMIN_ONLY:"true",WECOM_SYNC_DEVICE_ID:"mac-synthetic"};
const cookie=`${ADMIN_SESSION_COOKIE}=${createAdminSessionToken(env)}`;
const request=(kind,query="",headers={cookie})=>new Request(`http://localhost/api/wecom/${kind}${query}`,{headers});
try {
 for(const kind of ["reports","ca-alerts","status"]){
  assert.equal((await handleWecomRead(request(kind,"",{}),kind,{env})).status,401);
  assert.equal((await handleWecomRead(request(kind),kind,{env:{...env,WECOM_OWNER_ADMIN_ONLY:"false"}})).status,403);
  const response=await handleWecomRead(request(kind),kind,{env});
  assert.equal(response.status,200); assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.equal(response.headers.get("vary"),"Cookie");
  const publicResponse=await handleWecomRead(request(kind,"",{}),kind,{env:{...env,WECOM_PUBLIC_READ:"true",WECOM_OWNER_ADMIN_ONLY:"false"}});
  assert.equal(publicResponse.status,200);
  assert.equal(publicResponse.headers.get("cache-control"),"private, no-store");
 }
 for(const query of ["?limit=11","?limit=0","?limit=1.2","?limit=2&limit=3","?cadence=no","?ownerId=someone","?id=x&limit=1","?before=","?cadence=two_hour&cadence=daily"])
  assert.equal((await handleWecomRead(request("reports",query),"reports",{env})).status,400,query);
 for(const query of ["?active=true","?active=1&before=x","?active=1&limit=51","?limit=11","?limit=-1"])
  assert.equal((await handleWecomRead(request("ca-alerts",query),"ca-alerts",{env})).status,400,query);
 assert.equal((await handleWecomRead(request("status","?id=x"),"status",{env})).status,400);
 assert.equal((await handleWecomRead(request("reports","?deviceId=foreign&id=x"),"reports",{env})).status,403);
 assert.equal((await handleWecomRead(request("reports","?id=unknown"),"reports",{env})).status,404);
 assert.equal((await handleWecomRead(request("reports","?deviceId=foreign",{}),"reports",{env:{...env,WECOM_PUBLIC_READ:"true"}})).status,403);
 console.log("ok - WeCom read APIs fail closed, private responses and strict query combinations");
} finally {rmSync(dir,{recursive:true,force:true});}
