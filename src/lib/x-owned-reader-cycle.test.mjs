import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initXPipelineDb, getXPipelineFeedItem, getXPipelineHealth } from "./x-pipeline-store.ts";
import { getXOwnedReaderConfig } from "./x-owned-reader-config.ts";
import { getXOwnedReaderAccountState, getXAccountCoverageSnapshot } from "./x-owned-reader-state.ts";
import { runXOwnedReaderCycle } from "./x-owned-reader-cycle.ts";

const now=Date.parse("2026-10-04T02:00:00Z");
const config=getXOwnedReaderConfig({X_OWNED_READER_ENABLED:"true",X_OWNED_READER_SESSION_DB:"/private/session.db",X_OWNED_READER_COOLDOWN_FILE:"/private/cooldown.json"});
const db=new DatabaseSync(":memory:");initXPipelineDb(db);
let taskSeen;
function completion(task,complete,reason=null) {const account=task.accounts[0];return {version:1,runId:task.runId,type:"account_complete",username:account.username,userId:"321",complete,throughAt:account.throughAt,checkedAt:"2026-10-04T02:01:00Z",pages:complete?1:5,accepted:0,quarantined:0,reason,coverageKind:"posts-and-quotes",replyCoverageComplete:false,replyReason:"reply_focal_unverified"};}
await runXOwnedReaderCycle({accounts:["PHOTONCAP","Established985"],config,db,nowMs:now,bridgeRunner:async(task,_config,onEvent)=>{taskSeen=task;await onEvent(completion(task,false,"page_limit_reached"));await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
assert.equal(taskSeen.accounts.length,1);
assert.equal(getXOwnedReaderAccountState("photoncap",db).coveredThroughAt,null);
assert.equal(getXOwnedReaderAccountState("photoncap",db).pendingThroughAt,"2026-10-04T02:00:00.000Z");
for(let cycle=1;cycle<3;cycle++) await runXOwnedReaderCycle({accounts:["photoncap"],config,db,nowMs:now+cycle*300000,bridgeRunner:async(task,_config,onEvent)=>{assert.equal(task.accounts[0].fromAt,"2026-10-02T02:00:00.000Z");assert.equal(task.accounts[0].throughAt,"2026-10-04T02:00:00.000Z");await onEvent(completion(task,false,"page_limit_reached"));await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
assert.equal(getXOwnedReaderAccountState("photoncap",db).reason,"backlog_limit_repeated");
await runXOwnedReaderCycle({accounts:["photoncap"],config,db,nowMs:now+900000,bridgeRunner:async(task,_config,onEvent)=>{await onEvent(completion(task,true));await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
let state=getXOwnedReaderAccountState("photoncap",db);
assert.equal(state.coveredThroughAt,"2026-10-04T02:00:00.000Z");
assert.equal(state.lastSuccessfulCheckAt,"2026-10-04T02:01:00Z");
assert.equal(state.pendingThroughAt,null);
assert.equal(state.userId,"321");
const snapshot=getXAccountCoverageSnapshot(["photoncap"],db,{X_OWNED_READER_ENABLED:"true"},now+900000);
assert.equal(snapshot.accounts[0].coverageKind,"posts-and-quotes");
assert.equal(snapshot.accounts[0].replyCoverageComplete,false);
assert.equal(snapshot.counts.replyIncomplete,1);
assert.equal(getXPipelineHealth("collector",db),null);
assert.equal(getXPipelineHealth("owned-reader",db).status,"live");
const feedItem={id:"1987654321098765432",text:"durable original before translation",createdAt:"2026-10-04T02:05:00Z",username:"PhotonCap",displayName:"PhotonCap",profileUrl:"https://x.com/PhotonCap",userAvatar:"",tweetUrl:"https://x.com/PhotonCap/status/1987654321098765432",hashtags:[],likes:0,retweets:0,replies:0,quotes:0,views:0,media:[],quotedTweet:null,origin:"watch",queryLabel:"owned-reader / full",translation:null,contentSource:"owned-reader",contentComplete:true};
await runXOwnedReaderCycle({accounts:["photoncap"],config,db,nowMs:now+1200000,bridgeRunner:async(task,_config,onEvent)=>{assert.equal(task.accounts[0].fromAt,"2026-10-04T01:45:00.000Z");await onEvent({version:1,runId:task.runId,type:"tweet",account:{username:"photoncap",userId:"321"},feedItem,evidence:{entryId:"tweet-"+feedItem.id,entryType:"TimelineTimelineItem",selection:"standalone",tweetId:feedItem.id,userId:"321",pinned:false}});assert.equal(getXPipelineFeedItem(feedItem.id,db).text,feedItem.text);await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
assert.equal(getXOwnedReaderAccountState("photoncap",db).coveredThroughAt,"2026-10-04T02:00:00.000Z","missing account completion never advances coverage");
assert.equal(getXOwnedReaderAccountState("photoncap",db).reason,"account_missing_completion");
await runXOwnedReaderCycle({accounts:["photoncap"],config,db,nowMs:now+1500000,bridgeRunner:async(task,_config,onEvent)=>{await onEvent({version:1,runId:task.runId,type:"paused",reason:"rate_limited",nextRetryAt:"2026-10-04T03:00:00Z"});await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
const paused=await runXOwnedReaderCycle({accounts:["photoncap"],config,db,nowMs:now+1800000,bridgeRunner:async()=>{throw Error("must not access network during persisted cooldown");}});
assert.equal(paused.status,"paused");
assert.equal(paused.reason,"rate_limited");
db.close();

const brokenDb=new DatabaseSync(":memory:");initXPipelineDb(brokenDb);brokenDb.exec("create trigger reject_owned_feed before insert on x_feed begin select raise(abort,'write rejected'); end;");
const failed=await runXOwnedReaderCycle({accounts:["photoncap"],config,db:brokenDb,nowMs:now+1200000,bridgeRunner:async(task,_config,onEvent)=>{await onEvent({version:1,runId:task.runId,type:"tweet",account:{username:"photoncap",userId:"321"},feedItem,evidence:{entryId:"tweet-"+feedItem.id,entryType:"TimelineTimelineItem",selection:"standalone",tweetId:feedItem.id,userId:"321",pinned:false}});await onEvent({...completion(task,true),checkedAt:"2026-10-04T02:21:00Z",accepted:1});await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
assert.equal(failed.status,"error");
assert.equal(getXOwnedReaderAccountState("photoncap",brokenDb).coveredThroughAt,null,"durable feed commit must succeed before checkpoint");
brokenDb.close();

const mixedDb=new DatabaseSync(":memory:");initXPipelineDb(mixedDb);
for(const reason of ["page_limit_reached","unknown_conversation_module","page_limit_reached"]) await runXOwnedReaderCycle({accounts:["photoncap"],config,db:mixedDb,nowMs:now,bridgeRunner:async(task,_config,onEvent)=>{await onEvent(completion(task,false,reason));await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
assert.equal(getXOwnedReaderAccountState("photoncap",mixedDb).reason,"page_limit_reached","warning requires three consecutive scans reaching the same cap");
mixedDb.close();
const healthFailureDb=new DatabaseSync(":memory:");initXPipelineDb(healthFailureDb);healthFailureDb.exec("create trigger reject_health before insert on x_health begin select raise(abort,'health_write_rejected'); end;");
for(let attempt=0;attempt<2;attempt++)await assert.rejects(runXOwnedReaderCycle({accounts:["photoncap"],config,db:healthFailureDb,nowMs:now,bridgeRunner:async()=>{}}),/health_write_rejected/,"health persistence failure cannot leave the process permanently marked in flight");
healthFailureDb.close();

const budgetDirectory=await mkdtemp(join(tmpdir(),"owned-budget-restart-"));
try {for(const pauseReason of ["request_budget_reached","cycle_deadline_reached"]) {
  const dbPath=join(budgetDirectory,`${pauseReason}.sqlite`);
  let budgetDb=new DatabaseSync(dbPath);initXPipelineDb(budgetDb);
  const firstBudget=await runXOwnedReaderCycle({accounts:["photoncap"],config,db:budgetDb,nowMs:now,bridgeRunner:async(task,_config,onEvent)=>{await onEvent({version:1,runId:task.runId,type:"paused",reason:pauseReason,nextRetryAt:null});await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
  assert.equal(firstBudget.nextRetryAt,"2026-10-04T02:05:00.000Z","budget pause with no reset time needs a finite fallback");
  assert.equal(budgetDb.prepare("select next_retry_at from x_owned_reader_control where id=1").get().next_retry_at,"2026-10-04T02:05:00.000Z");
  budgetDb.close();budgetDb=new DatabaseSync(dbPath);initXPipelineDb(budgetDb);
  const cooldown=await runXOwnedReaderCycle({accounts:["photoncap"],config,db:budgetDb,nowMs:now+299999,bridgeRunner:async()=>{throw new Error("budget cooldown must not make a request");}});
  assert.equal(cooldown.status,"paused");assert.equal(cooldown.reason,pauseReason);
  assert.equal(getXAccountCoverageSnapshot(["photoncap"],budgetDb,{X_OWNED_READER_ENABLED:"true"},now+299999).accounts[0].status,"paused","pause health derives from persisted control independently of process memory");
  const resumed=await runXOwnedReaderCycle({accounts:["photoncap"],config,db:budgetDb,nowMs:now+300000,bridgeRunner:async(task,_config,onEvent)=>{assert.equal(task.accounts[0].throughAt,"2026-10-04T02:00:00.000Z");await onEvent({...completion(task,true),checkedAt:"2026-10-04T02:05:01Z"});await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
  assert.equal(resumed.completed,1);assert.equal(resumed.status,"live");assert.equal(getXOwnedReaderAccountState("photoncap",budgetDb).coveredThroughAt,"2026-10-04T02:00:00.000Z");
  assert.equal(getXAccountCoverageSnapshot(["photoncap"],budgetDb,{X_OWNED_READER_ENABLED:"true"},now+300000).accounts[0].status,"complete");
  budgetDb.close();
}} finally {await rm(budgetDirectory,{recursive:true,force:true});}

const authDb=new DatabaseSync(":memory:");initXPipelineDb(authDb);
const authPause=await runXOwnedReaderCycle({accounts:["photoncap"],config,db:authDb,nowMs:now,bridgeRunner:async(task,_config,onEvent)=>{await onEvent({version:1,runId:task.runId,type:"paused",reason:"login_or_access_challenge",nextRetryAt:null});await onEvent({version:1,runId:task.runId,type:"cycle_complete"});}});
assert.equal(authPause.nextRetryAt,null);
const authLater=await runXOwnedReaderCycle({accounts:["photoncap"],config,db:authDb,nowMs:now+86400000,bridgeRunner:async()=>{throw new Error("auth pause requires controlled session recovery");}});
assert.equal(authLater.status,"paused");assert.equal(authLater.reason,"login_or_access_challenge");authDb.close();
console.log("Owned cycle: fixed incomplete recovery, cap warning, raw-first commit, empty complete, explicit reply limitation, no checkpoint on missing completion/write failure and persistent cooldown passed.");
