import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createAdminSessionToken } from "./admin-auth.ts";
import { initXPipelineDb } from "./x-pipeline-store.ts";
import { GET } from "../app/api/x/coverage/route.ts";

const dir=await mkdtemp(join(tmpdir(),"coverage-route-test-"));
const original={...process.env};
try {
  process.env.ADMIN_PASSWORD="test-admin";process.env.ADMIN_SESSION_SECRET="test-secret";
  process.env.X_PIPELINE_DB=join(dir,"coverage.sqlite");
  process.env.X_OWNED_READER_ENABLED="true";process.env.X_OWNED_READER_SESSION_DB="/private/session.db";process.env.TWITTER_WATCH_USERNAMES="PhotonCap,Established985";
  const denied=await GET(new Request("http://localhost/api/x/coverage"));
  assert.equal(denied.status,401);
  await assert.rejects(access(process.env.X_PIPELINE_DB),"unauthenticated reads cannot create databases");
  const db=new DatabaseSync(process.env.X_PIPELINE_DB);initXPipelineDb(db);const originalTables=db.prepare("select name from sqlite_master where type='table'").all();db.close();
  const response=await GET(new Request("http://localhost/api/x/coverage",{headers:{cookie:`signal_hub_admin=${createAdminSessionToken()}`}}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  const body=await response.json();assert.equal(body.counts.ownedReader,1);assert.equal(body.counts.monitor985,1);
  assert.equal(JSON.stringify(body).includes("private/session"),false);
  const after=new DatabaseSync(process.env.X_PIPELINE_DB,{readOnly:true});assert.deepEqual(after.prepare("select name from sqlite_master where type='table'").all(),originalTables);after.close();
} finally {
  for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);
  await rm(dir,{recursive:true,force:true});
}
console.log("Owned coverage API: actual authenticated GET, private response, source routes, no secrets or DB mutations passed.");
