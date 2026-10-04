import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createXOwnedReaderScheduler, runXOwnedReaderDoctor } from "./x-owned-reader-worker.mjs";
import { getXOwnedReaderConfig } from "../src/lib/x-owned-reader-config.ts";

let now=0;let release;let completed=0;
const scheduler=createXOwnedReaderScheduler({intervalMs:300000,now:()=>now,runCycle:()=>new Promise(resolve=>{release=()=>{completed++;resolve({status:"live"});};})});
const running=scheduler.run();now=180000;
assert.equal((await scheduler.run()).reason,"in_progress");release();await running;
assert.equal(scheduler.delayUntilNextStart(),120000,"the next start is five minutes after the previous start");
assert.equal((await scheduler.run()).reason,"not_due");now=300000;
const second=scheduler.run();release();await second;assert.equal(completed,2);

const directory=await mkdtemp(join(tmpdir(),"owned-worker-test-"));
try {
  const fakeBridge=join(directory,"doctor.mjs");
  await writeFile(fakeBridge,"let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const t=JSON.parse(s); if(t.mode!=='doctor'||t.accounts.length!==0)process.exit(2); console.log(JSON.stringify({version:1,runId:t.runId,type:'doctor',protocolVersion:1,sdkVersion:'0.20.1',sessionAvailable:true,coolingDown:false,nextRetryAt:null})); console.log(JSON.stringify({version:1,runId:t.runId,type:'cycle_complete'}));});");
  const config={...getXOwnedReaderConfig({}),pythonPath:process.execPath,bridgePath:fakeBridge,sessionDbPath:"/private/session.db",cooldownFilePath:"/private/cooldown.json"};
  const doctor=await runXOwnedReaderDoctor(config);
  assert.equal(doctor.ok,true);
  assert.equal(doctor.sdkVersion,"0.20.1");
  assert.equal(JSON.stringify(doctor).includes("private"),false);
  const productDb=join(directory,"never-created.sqlite");
  const script=resolve("scripts/x-owned-reader-worker.mjs");
  const child=spawnSync(process.execPath,["--experimental-strip-types","--experimental-transform-types",script,"--doctor"],{cwd:directory,encoding:"utf8",env:{...process.env,X_OWNED_READER_ENABLED:"true",X_OWNED_READER_PYTHON:process.execPath,X_OWNED_READER_BRIDGE_PATH:fakeBridge,X_OWNED_READER_SESSION_DB:"/private/session.db",X_OWNED_READER_COOLDOWN_FILE:"/private/cooldown.json",X_PIPELINE_DB:productDb}});
  assert.equal(child.status,0,child.stderr);
  assert.equal(JSON.parse(child.stdout.trim()).ok,true);
  await assert.rejects(access(productDb),"doctor must not initialize the product DB");
  const disabledDb=join(directory,"disabled.sqlite");
  const disabled=spawnSync(process.execPath,["--experimental-strip-types","--experimental-transform-types",script,"--once"],{cwd:directory,encoding:"utf8",env:{...process.env,X_OWNED_READER_ENABLED:"false",X_PIPELINE_DB:disabledDb}});
  assert.equal(disabled.status,0,disabled.stderr);
  assert.equal(JSON.parse(disabled.stdout.trim()).status,"paused");
  assert.equal(JSON.parse(disabled.stdout.trim()).reason,"disabled");
} finally {await rm(directory,{recursive:true,force:true});}
console.log("Owned worker: single-flight start-to-start scheduling, real doctor child with no product DB writes, and disabled once mode passed.");
