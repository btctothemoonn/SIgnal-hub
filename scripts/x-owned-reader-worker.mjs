import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getXOwnedReaderConfig } from "../src/lib/x-owned-reader-config.ts";
import { runXOwnedReaderCycle } from "../src/lib/x-owned-reader-cycle.ts";
import { runOwnedReaderBridge } from "../src/lib/x-owned-reader-protocol.ts";
import { safeXOwnedReason } from "../src/lib/x-owned-reader-state.ts";
import { getXPipelineConfiguredAccounts } from "../src/lib/x-pipeline-accounts.ts";
import { loadRuntimeConfig } from "../src/lib/runtime-config.ts";
import { backfillMissingXTranslations } from "../src/lib/x-translation-backfill.ts";

function log(event,data={}) { console.log(JSON.stringify({at:new Date().toISOString(),event,...data})); }
async function loadEnvFile(path) {
  try {
    const source=await readFile(path,"utf8");
    for(const line of source.split(/\r?\n/)) {
      const value=line.trim(); if(!value || value.startsWith("#"))continue;
      const separator=value.indexOf("=");if(separator<1)continue;
      const key=value.slice(0,separator).trim();
      if(!process.env[key])process.env[key]=value.slice(separator+1).trim().replace(/^["']|["']$/g,"");
    }
  } catch { /* A service may supply its environment without local env files. */ }
}

export function createXOwnedReaderScheduler({intervalMs=300000,now=Date.now,runCycle}) {
  let lastStartedAt=null;let inFlight=false;
  return {
    delayUntilNextStart() {return lastStartedAt===null ? 0 : Math.max(0,lastStartedAt+intervalMs-now());},
    async run() {
      if(inFlight)return {status:"skipped",reason:"in_progress"};
      if(lastStartedAt!==null && now()<lastStartedAt+intervalMs)return {status:"skipped",reason:"not_due"};
      inFlight=true;lastStartedAt=now();
      try {return await runCycle();} finally {inFlight=false;}
    },
  };
}

export async function runXOwnedReaderDoctor(config=getXOwnedReaderConfig(),bridgeRunner=runOwnedReaderBridge) {
  const summary={ok:false,protocolVersion:1,sdkVersion:null,sessionAvailable:false,coolingDown:false,nextRetryAt:null,reason:null};
  if(!config.sessionDbPath || !config.cooldownFilePath)return {...summary,reason:"configuration_missing"};
  let checked=false;
  const task={version:1,mode:"doctor",runId:randomUUID(),sessionDbPath:config.sessionDbPath,cooldownFilePath:config.cooldownFilePath,maxRequests:0,deadlineMs:Math.min(config.deadlineMs,10000),minIntervalMs:config.minIntervalMs,maxPages:0,accounts:[]};
  try {
    await bridgeRunner(task,config,event=>{
      if(event.type === "doctor") {
        if(checked)throw new Error("protocol_invalid");checked=true;
        summary.sdkVersion=event.sdkVersion;summary.sessionAvailable=event.sessionAvailable;summary.coolingDown=event.coolingDown;summary.nextRetryAt=event.nextRetryAt;
      } else if(event.type === "error" || event.type === "paused") summary.reason=safeXOwnedReason(event.reason,"bridge_failed");
    });
    summary.ok=checked && summary.sdkVersion === "0.20.1" && summary.sessionAvailable;
    if(!summary.ok && !summary.reason)summary.reason=!checked ? "bridge_missing_completion" : summary.sdkVersion!=="0.20.1" ? "sdk_unavailable" : "session_unavailable";
  } catch(error) {summary.reason=safeXOwnedReason(error instanceof Error ? error.message : null,"bridge_failed");}
  return summary;
}

async function main() {
  await loadEnvFile(resolve(process.cwd(),".env.local"));await loadEnvFile(resolve(process.cwd(),".env"));
  const config=getXOwnedReaderConfig();
  if(process.argv.includes("--doctor")) {
    const summary=await runXOwnedReaderDoctor(config);console.log(JSON.stringify(summary));if(!summary.ok)process.exitCode=1;return;
  }
  const once=process.argv.includes("--once");let translationInFlight=false;
  const scheduler=createXOwnedReaderScheduler({intervalMs:config.intervalMs,runCycle:async()=>{
    const accounts=getXPipelineConfiguredAccounts(await loadRuntimeConfig());
    const result=await runXOwnedReaderCycle({accounts,config});
    log("x_owned_reader_cycle",result);
    if(result.ingested>0 && !translationInFlight) {
      translationInFlight=true;
      void backfillMissingXTranslations({limit:5}).catch(()=>log("x_owned_reader_translation_failed",{reason:"translation_failed"})).finally(()=>{translationInFlight=false;});
    }
    return result;
  }});
  const result=await scheduler.run();
  if(once || !config.enabled) {if(result.status==="error")process.exitCode=1;return;}
  const schedule=()=>{setTimeout(()=>{void scheduler.run().catch(()=>log("x_owned_reader_worker_failed",{reason:"bridge_failed"})).finally(schedule);},scheduler.delayUntilNextStart());};
  schedule();
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{log("x_owned_reader_worker_failed",{reason:safeXOwnedReason(error instanceof Error ? error.message : null,"bridge_failed")});process.exitCode=1;});
}
