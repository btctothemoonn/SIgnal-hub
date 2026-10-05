import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getXPipelineDb, setXPipelineHealth, upsertXPipelineRealtimeUpdate } from "./x-pipeline-store.ts";
import { normalizeXOwnedUsername, type XOwnedReaderConfig } from "./x-owned-reader-config.ts";
import { getXOwnedReaderAccountState, getXOwnedReaderPause, initXOwnedReaderStateDb, pauseXOwnedReader, prepareXOwnedReaderAccounts, recordXOwnedReaderRoutes, safeXOwnedReason, getEffectiveXOwnedReaderConfig } from "./x-owned-reader-state.ts";
import { runOwnedReaderBridge, validateXOwnedReaderEvent, type XOwnedReaderTask, type XOwnedReaderEvent } from "./x-owned-reader-protocol.ts";
import { prepare985AuditAccounts, complete985Audit, fetch985AuditEvidence, sync985ConfiguredAuthors, sync985AuthorMonitoringEvidence, type X985AuditEvidence } from "./x-985-audit.ts";
import type { TwitterFeedItem } from "./6551-twitter.ts";

let inFlight=false;
type BridgeRunner=(task:XOwnedReaderTask,config:XOwnedReaderConfig,onEvent:(event:XOwnedReaderEvent)=>unknown|Promise<unknown>)=>Promise<void>;
type CycleOptions={accounts:readonly (string|{username:string})[];config:XOwnedReaderConfig;db?:DatabaseSync;nowMs?:number;clock?:()=>number;bridgeRunner?:BridgeRunner;auditEvidenceProvider?:()=>Promise<X985AuditEvidence>};

export async function runXOwnedReaderCycle({accounts,config,db=getXPipelineDb(),nowMs=Date.now(),clock=Date.now,bridgeRunner=runOwnedReaderBridge,auditEvidenceProvider=fetch985AuditEvidence}:CycleOptions) {
  const result={status:"live",runId:randomUUID(),attempted:0,completed:0,incomplete:0,ingested:0,requests:null as number|null,auditAttempted:0,auditCompleted:0,auditIncomplete:0,promotedUsernames:[] as string[],reason:null as string|null,nextRetryAt:null as string|null};
  if(inFlight) return {...result,status:"skipped",reason:"in_progress"};
  inFlight=true;
  const pending=new Set<string>();const done=new Set<string>();const identities=new Map<string,string>();let cycleComplete=false;let globalPaused=false;let task:XOwnedReaderTask;
  const auditItems=new Map<string,TwitterFeedItem[]>();const auditPending=new Set<string>();let auditEvidence:X985AuditEvidence={healthy:false,monitored:[],tweetIds:[]};
  try {
    initXOwnedReaderStateDb(db);
    config=getEffectiveXOwnedReaderConfig(config,db);
    const usernames=accounts.map(account=>typeof account === "string" ? account : account.username);
    if(config.auditEnabled)sync985ConfiguredAuthors(usernames,db,nowMs);
    recordXOwnedReaderRoutes(usernames,config,db,nowMs);
    const pause=getXOwnedReaderPause(db);
    if(!config.enabled || (pause && (!pause.nextRetryAt || Date.parse(pause.nextRetryAt)>nowMs))) {
      result.status="paused";result.reason=config.enabled ? pause!.reason : "disabled";result.nextRetryAt=pause?.nextRetryAt || null;
      setXPipelineHealth({scope:"owned-reader",status:"paused",detail:result.reason},db);return result;
    }
    if(!config.sessionDbPath || !config.cooldownFilePath) {
      result.status="error";result.reason="configuration_missing";setXPipelineHealth({scope:"owned-reader",status:"error",detail:"configuration_missing"},db);return result;
    }
    if(pause) db.prepare("update x_owned_reader_control set paused=0 where id=1").run();
    const ordered=[...usernames].sort((a,b)=>String(getXOwnedReaderAccountState(a,db)?.lastSuccessfulCheckAt || '').localeCompare(String(getXOwnedReaderAccountState(b,db)?.lastSuccessfulCheckAt || '')));
    const queryAccounts=prepareXOwnedReaderAccounts(ordered,config,db,nowMs);
    result.attempted=queryAccounts.length;
    queryAccounts.forEach(account=>pending.add(account.username));
    if(!queryAccounts.length) {setXPipelineHealth({scope:"owned-reader",status:"paused",detail:"no configured owned-reader accounts"},db);return {...result,status:"paused"};}
    let auditAccounts=config.auditEnabled ? prepare985AuditAccounts(usernames,config.allowlist,db,nowMs) : [];
    if(auditAccounts.length) {
      auditEvidence=await auditEvidenceProvider();
      sync985AuthorMonitoringEvidence(auditEvidence,db,nowMs);
      if(!auditEvidence.healthy) {
        for(const account of auditAccounts)complete985Audit({username:account.username,complete:false,reason:'upstream_evidence_unavailable'},[],auditEvidence,db,nowMs);
        auditAccounts=[];
      }
    }
    result.auditAttempted=auditAccounts.length;auditAccounts.forEach(account=>{auditPending.add(account.username);auditItems.set(account.username,[]);});
    task={version:1,runId:result.runId,sessionDbPath:config.sessionDbPath,cooldownFilePath:config.cooldownFilePath,maxRequests:config.maxRequests,deadlineMs:config.deadlineMs,minIntervalMs:config.minIntervalMs,maxPages:config.maxPages,accounts:[...queryAccounts,...auditAccounts]};
    setXPipelineHealth({scope:"owned-reader",status:"connecting",detail:`checking ${queryAccounts.length} trial accounts`},db);
    await bridgeRunner(task,config,async(raw)=>{
      const event=validateXOwnedReaderEvent(raw,task);
      if(cycleComplete || (globalPaused && event.type!=="cycle_complete" && event.type!=="error")) throw new Error("protocol_invalid");
      if(event.type==="cycle_complete") {cycleComplete=true;result.requests=typeof event.requests==='number'?event.requests:null;return;}
      if(event.type==="paused") {
        globalPaused=true;result.status="paused";result.reason=safeXOwnedReason(event.reason);
        const temporaryBudgetPause=["request_budget_reached","cycle_deadline_reached"].includes(result.reason);
        result.nextRetryAt=event.nextRetryAt as string|null;
        if(temporaryBudgetPause && !result.nextRetryAt) result.nextRetryAt=new Date(nowMs+config.intervalMs).toISOString();
        pauseXOwnedReader(result.reason,result.nextRetryAt,db,nowMs);return;
      }
      if(event.type==="error") {result.status="error";result.reason=safeXOwnedReason(event.reason,"bridge_failed");return;}
      if(event.type==="tweet") {
        const username=event.account!.username;const userId=event.account!.userId;
        if(done.has(username) || (identities.has(username) && identities.get(username)!==userId)) throw new Error("protocol_invalid");
        identities.set(username,userId);
        const item=event.feedItem!;
        if(auditItems.has(username)) {auditItems.get(username)!.push(item);return;}
        db.exec("savepoint owned_reader_feed");
        try {upsertXPipelineRealtimeUpdate({eventType:item.eventType || (item.quotedTweet?.relation === "reply" ? "NEW_TWEET_REPLY" : item.quotedTweet ? "NEW_TWEET_QUOTE" : "NEW_TWEET"),account:username,displayName:item.displayName,createdAt:item.createdAt,profileUrl:item.profileUrl,remark:"owned-reader",feedItem:item},db);db.prepare("update x_owned_reader_state set last_ingested_at=? where username_key=?").run(new Date(nowMs).toISOString(),username);db.exec("release owned_reader_feed");result.ingested++;}catch{db.exec("rollback to owned_reader_feed");db.exec("release owned_reader_feed");throw new Error("feed_write_failed");}
        return;
      }
      if(event.type!=="account_complete") throw new Error("protocol_invalid");
      const username=normalizeXOwnedUsername(event.username);
      if(done.has(username) || (identities.has(username) && identities.get(username)!==event.userId)) throw new Error("protocol_invalid");
      if(auditItems.has(username)) {
        const items=auditItems.get(username)!;
        const audited=complete985Audit(event,items,auditEvidence,db,Math.max(nowMs,clock()));
        if(audited.promotedIds.length) {
          result.promotedUsernames.push(username);
          for(const item of items.filter(value=>audited.promotedIds.includes(value.id))) {
            upsertXPipelineRealtimeUpdate({eventType:item.eventType || (item.quotedTweet ? "NEW_TWEET_QUOTE" : "NEW_TWEET"),account:username,displayName:item.displayName,createdAt:item.createdAt,profileUrl:item.profileUrl,remark:"owned-reader",feedItem:item},db);result.ingested++;
          }
          recordXOwnedReaderRoutes(usernames,config,db,nowMs);
        }
        done.add(username);auditPending.delete(username);
        if(event.complete)result.auditCompleted++;else result.auditIncomplete++;
        return;
      }
      const state=getXOwnedReaderAccountState(username,db)!;
      const incompleteCount=event.complete ? 0 : state.lastIncompleteReason===event.reason ? state.incompleteCount+1 : 1;
      const reason=event.complete ? null : incompleteCount>=3 && ["page_limit_reached","request_budget_reached","cycle_deadline_reached"].includes(String(event.reason)) ? "backlog_limit_repeated" : safeXOwnedReason(event.reason);
      db.prepare(`update x_owned_reader_state set user_id=?,status=?,reason=?,next_retry_at=null,incomplete_count=?,last_incomplete_reason=?,coverage_kind=?,reply_coverage_complete=?,reply_reason=?,subscriber_content_excluded=?,subscriber_excluded_tweet_ids_json=?,covered_through_at=case when ?=1 then ? else covered_through_at end,last_successful_check_at=case when ?=1 then ? else last_successful_check_at end,pending_through_at=case when ?=1 then null else pending_through_at end,updated_at=? where username_key=?`).run(String(event.userId),event.complete ? "complete" : "incomplete",reason,incompleteCount,event.complete ? null : safeXOwnedReason(event.reason),"posts-and-quotes",event.replyCoverageComplete ? 1 : 0,event.replyReason as string|null,Number(event.subscriberContentExcluded),JSON.stringify(event.subscriberExcludedTweetIds),event.complete ? 1 : 0,String(event.throughAt),event.complete ? 1 : 0,String(event.checkedAt),event.complete ? 1 : 0,new Date(nowMs).toISOString(),username);
      done.add(username);pending.delete(username);if(event.complete)result.completed++;else result.incomplete++;
    });
    if(!cycleComplete) throw new Error("bridge_missing_completion");
    if(pending.size && !globalPaused) {result.incomplete+=pending.size;if(result.status!=="error")result.status="incomplete";result.reason ||= "account_missing_completion";}
    if(result.incomplete && result.status==="live")result.status="incomplete";
  } catch(error) {result.status="error";result.reason=safeXOwnedReason(error instanceof Error ? error.message : null,"bridge_failed");}
  finally {
    inFlight=false;
    for(const username of auditPending) {
      complete985Audit({username,complete:false,reason:result.reason || "account_missing_completion"},[],auditEvidence,db,nowMs);result.auditIncomplete++;
    }
    const status=result.status === "paused" ? "paused" : result.status === "error" || result.status === "incomplete" ? "error" : "live";
    for(const username of pending) db.prepare("update x_owned_reader_state set status=?,reason=?,next_retry_at=?,updated_at=? where username_key=?").run(result.status === "paused" ? "paused" : "incomplete",result.reason || "account_missing_completion",result.nextRetryAt,new Date(nowMs).toISOString(),username);
    setXPipelineHealth({scope:"owned-reader",status,detail:result.reason || `${result.completed}/${result.attempted} posts-and-quotes checks complete; ${result.ingested} feed items committed`},db);
  }
  return result;
}
