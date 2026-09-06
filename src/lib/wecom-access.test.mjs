import assert from "node:assert/strict";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "./admin-auth.ts";
import { authorizeWecomRead, wecomPrivateJson } from "./wecom-access.ts";
const env = { ADMIN_PASSWORD:"synthetic-owner", ADMIN_SESSION_SECRET:"test-admin-secret-".repeat(4), WECOM_SYNC_DEVICE_ID:"fixture-device", WECOM_OWNER_ADMIN_ONLY:"true" };
const token = createAdminSessionToken(env);
const req = (query="", cookie=`${ADMIN_SESSION_COOKIE}=${token}`) => new Request(`https://example.invalid/api/wecom/reports${query}`, {headers: {cookie}});
assert.throws(() => authorizeWecomRead(req("", ""), env), e => e.status===401);
assert.throws(() => authorizeWecomRead(req("",`${ADMIN_SESSION_COOKIE}=bad`), env), e => e.status===401);
assert.throws(() => authorizeWecomRead(req(), {...env,WECOM_OWNER_ADMIN_ONLY:"false"}), e => e.status===403);
assert.throws(() => authorizeWecomRead(req(), {...env,WECOM_SYNC_DEVICE_ID:undefined}), e => e.status===403);
assert.throws(() => authorizeWecomRead(req("?deviceId=other"),env), e => e.status===403);
assert.throws(() => authorizeWecomRead(req("",`${ADMIN_SESSION_COOKIE}=${token}; ${ADMIN_SESSION_COOKIE}=${token}`),env), e => e.status===401);
assert.deepEqual(authorizeWecomRead(req(),env),{ownerId:"admin",deviceId:"fixture-device"});
const publicEnv = { WECOM_PUBLIC_READ:"true", WECOM_SYNC_DEVICE_ID:"fixture-device" };
for (const path of ["/wecom", "/api/wecom/reports", "/api/wecom/ca-alerts", "/api/wecom/status"]) {
 for (const method of ["GET", "HEAD"]) {
  assert.deepEqual(authorizeWecomRead(new Request(`https://example.invalid${path}`, {method}), publicEnv),
   {ownerId:"admin",deviceId:"fixture-device"});
 }
}
for (const path of ["/settings", "/api/holdings", "/api/wecom/ingest", "/api/wecom/reports/extra"]) {
 assert.throws(() => authorizeWecomRead(new Request(`https://example.invalid${path}`), publicEnv), e => e.status===401);
}
assert.throws(() => authorizeWecomRead(new Request("https://example.invalid/api/wecom/reports", {method:"POST"}), publicEnv), e => e.status===401);
assert.throws(() => authorizeWecomRead(req("?deviceId=other", ""), publicEnv), e => e.status===403);
assert.throws(() => authorizeWecomRead(req("", ""), {...publicEnv,WECOM_SYNC_DEVICE_ID:""}), e => e.status===403);
assert.throws(() => authorizeWecomRead(req("", ""), {...publicEnv,WECOM_PUBLIC_READ:"false"}), e => e.status===401);
const result=wecomPrivateJson({ok:true});
assert.equal(result.headers.get("cache-control"),"private, no-store");
console.log("ok - WeCom explicit owner authorization and private reads");
