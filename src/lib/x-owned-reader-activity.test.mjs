import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initXPipelineDb, upsertXPipelineRealtimeUpdate } from "./x-pipeline-store.ts";
import { getXOwnedReaderConfig } from "./x-owned-reader-config.ts";
import { getXAccountCoverageSnapshot } from "./x-owned-reader-state.ts";
import { runXOwnedReaderCycle } from "./x-owned-reader-cycle.ts";
import { isXOwnedReaderCheckDue, xOwnedReaderCheckRounds, xOwnedReaderStaleAfterForRounds } from "./x-owned-reader-activity.ts";

const interval=960000;
const env={X_OWNED_READER_ACTIVITY_TIERS:"true",X_OWNED_READER_ENABLED:"true",X_OWNED_READER_SESSION_DB:"/private/session.db",X_OWNED_READER_COOLDOWN_FILE:"/private/cooldown.json",X_OWNED_READER_INTERVAL_MS:String(interval),X_OWNED_READER_USERNAMES:"busy,quiet"};
const config=getXOwnedReaderConfig(env);
const start=Date.parse("2026-11-12T10:00:00Z");
const db=new DatabaseSync(":memory:");initXPipelineDb(db);

function post(username,id,createdAt) {
  const feedItem={id,text:"post "+id,createdAt,username,displayName:username,profileUrl:`https://x.com/${username}`,userAvatar:"",tweetUrl:`https://x.com/${username}/status/${id}`,hashtags:[],likes:0,retweets:0,replies:0,quotes:0,views:0,media:[],quotedTweet:null,origin:"watch",queryLabel:"test",translation:null,contentSource:"owned-reader",contentComplete:true};
  upsertXPipelineRealtimeUpdate({eventType:"NEW_TWEET",account:username,displayName:username,createdAt,profileUrl:feedItem.profileUrl,remark:"owned-reader",feedItem},db);
}
for(let index=0;index<30;index++)post("busy",String(1990000000000000000n+BigInt(index)),new Date(start-index*3*60*60_000).toISOString());
post("quiet","1980000000000000001",new Date(start-3*24*60*60_000).toISOString());

assert.equal(xOwnedReaderCheckRounds("busy",db,start),1);
assert.equal(xOwnedReaderCheckRounds("quiet",db,start),3);
assert.equal(xOwnedReaderCheckRounds("nobody",db,start),3,"authors with no recent posts are quiet");
assert.equal(xOwnedReaderStaleAfterForRounds(1000,interval,3),1000+2*interval);
assert.equal(isXOwnedReaderCheckDue(null,3,interval,start),true,"never checked authors are always due");
assert.equal(isXOwnedReaderCheckDue({status:"incomplete",lastSuccessfulCheckAt:new Date(start).toISOString()},3,interval,start+1),true,"incomplete authors are retried every round");

async function round(nowMs) {
  let seen=[];
  const result=await runXOwnedReaderCycle({accounts:["busy","quiet"],config,db,nowMs,clock:()=>nowMs,auditEvidenceProvider:async()=>({healthy:false,monitored:[],tweetIds:[]}),bridgeRunner:async(task,_config,onEvent)=>{
    seen=task.accounts.map(account=>account.username);
    for(const account of task.accounts)await onEvent({version:1,runId:task.runId,type:"account_complete",username:account.username,userId:account.username==="busy"?"1":"2",complete:true,throughAt:account.throughAt,checkedAt:new Date(nowMs).toISOString(),pages:1,accepted:0,quarantined:0,reason:null,coverageKind:"posts-and-quotes",replyCoverageComplete:true,replyReason:null,subscriberContentExcluded:0,subscriberExcludedTweetIds:[]});
    await onEvent({version:1,runId:task.runId,type:"cycle_complete",requests:task.accounts.length});
  }});
  return {result,seen:seen.sort()};
}

let outcome=await round(start);
assert.deepEqual(outcome.seen,["busy","quiet"],"first round after start checks everyone");
outcome=await round(start+interval);
assert.deepEqual(outcome.seen,["busy"],"quiet author is deferred on the next round");
assert.equal(outcome.result.deferredQuiet,1);
outcome=await round(start+2*interval);
assert.deepEqual(outcome.seen,["busy"]);
outcome=await round(start+3*interval);
assert.deepEqual(outcome.seen,["busy","quiet"],"quiet author is checked every third round");

const snapshot=getXAccountCoverageSnapshot(["busy","quiet"],db,env,start+5*interval);
const quiet=snapshot.accounts.find(account=>account.username==="quiet");
const busy=snapshot.accounts.find(account=>account.username==="busy");
assert.equal(quiet.stale,false,"quiet author within its longer window is not overdue");
assert.equal(busy.stale,true,"busy author keeps the normal overdue window");
db.close();
