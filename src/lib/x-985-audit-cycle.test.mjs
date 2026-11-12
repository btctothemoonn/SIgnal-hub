import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initXPipelineDb,getXPipelineFeedItem } from './x-pipeline-store.ts';
import { getXOwnedReaderConfig } from './x-owned-reader-config.ts';
import { getXAccountCoverageSnapshot } from './x-owned-reader-state.ts';
import { runXOwnedReaderCycle } from './x-owned-reader-cycle.ts';
import { record985RawPayload, record985StreamState, prepare985AuditAccounts, sync985AuthorMonitoringEvidence } from './x-985-audit.ts';

const db=new DatabaseSync(':memory:');initXPipelineDb(db);
const base=Date.parse('2026-10-04T03:00:00Z');
const env={X_OWNED_READER_ENABLED:'true',X_985_AUDIT_ENABLED:'true',X_OWNED_READER_USERNAMES:'owned',X_OWNED_READER_SESSION_DB:'/private/account.db',X_OWNED_READER_COOLDOWN_FILE:'/private/cooldown.json'};
const config=getXOwnedReaderConfig(env);
function pulse(database,fromMinute,throughMinute) {
 for(let minute=fromMinute+1;minute<=throughMinute;minute++)record985StreamState('heartbeat',database,base+minute*60000);
}
function establishMonitoring(database) {
 prepare985AuditAccounts(['owned','primary'],['owned'],database,base,0);
 sync985AuthorMonitoringEvidence({healthy:true,monitored:['primary'],tweetIds:[]},database,base);
 database.prepare('delete from x_985_audit_control').run();
}
establishMonitoring(db);
const item={id:'2106500000000000000',username:'primary',displayName:'primary',text:'public post',createdAt:new Date(base+60000).toISOString(),profileUrl:'https://x.com/primary',userAvatar:'',tweetUrl:'https://x.com/primary/status/2106500000000000000',hashtags:[],likes:0,retweets:0,replies:0,quotes:0,views:0,media:[],quotedTweet:null,origin:'watch',queryLabel:'owned-reader / full',translation:null,contentSource:'owned-reader',contentComplete:true};
record985StreamState('connected',db,base);
const tasks=[];
async function bridge(task,_config,onEvent) {
 tasks.push(task);
 for(const account of task.accounts) {
  if(account.purpose==='audit')await onEvent({version:1,runId:task.runId,type:'tweet',account:{username:account.username,userId:'321'},feedItem:item,evidence:{entryId:'tweet-'+item.id,entryType:'TimelineTimelineItem',selection:'standalone',tweetId:item.id,userId:'321',pinned:false}});
  await onEvent({version:1,runId:task.runId,type:'account_complete',username:account.username,userId:'321',complete:true,throughAt:account.throughAt,checkedAt:account.throughAt,pages:1,accepted:account.purpose==='audit'?1:0,quarantined:0,reason:null,coverageKind:'posts-and-quotes',replyCoverageComplete:false,replyReason:'reply_page_budget_unavailable'});
 }
 await onEvent({version:1,runId:task.runId,type:'cycle_complete'});
}
let previousMinute=0;
for(const minute of [12,17,22]) {
 pulse(db,previousMinute,minute);previousMinute=minute;
 await runXOwnedReaderCycle({accounts:['owned','primary'],config,db,nowMs:base+minute*60000,clock:()=>base+minute*60000,bridgeRunner:bridge,auditEvidenceProvider:async()=>({healthy:true,monitored:['primary'],tweetIds:[]})});
 if(minute<22) {
  assert.equal(getXPipelineFeedItem(item.id,db)?.text,item.text,'first complete audit recovers the missing post');
  assert.equal(getXAccountCoverageSnapshot(['owned','primary'],db,env,base+minute*60000).accounts[1].route,'monitor985','recovering a post does not migrate its author');
 }
}
assert.equal(tasks[0].accounts[0].username,'owned','production authors have priority');
assert.equal(tasks[0].accounts[1].purpose,'audit');
assert.equal(tasks[1].accounts.length,1,'no routine rescan after five minutes');
assert.equal(getXPipelineFeedItem(item.id,db).text,item.text,'confirmed missing item immediately committed');
const snapshot=getXAccountCoverageSnapshot(['owned','primary'],db,env,base+22*60000);
assert.equal(snapshot.accounts[1].route,'owned-reader');
assert.equal(snapshot.accounts[1].routeReason,'confirmed_985_missing');
assert.equal(snapshot.accounts[1].audit.confirmedMissingTweetId,item.id);
pulse(db,22,27);
await runXOwnedReaderCycle({accounts:['owned','primary'],config,db,nowMs:base+27*60000,bridgeRunner:bridge,auditEvidenceProvider:async()=>{throw new Error('not due');}});
assert.equal(tasks.at(-1).accounts.length,2);
assert.ok(tasks.at(-1).accounts.every(account=>!account.purpose),'persisted promotion is included without env restart');
db.close();
const lateDb=new DatabaseSync(':memory:');initXPipelineDb(lateDb);
establishMonitoring(lateDb);
record985StreamState('connected',lateDb,base);
pulse(lateDb,0,12);
await runXOwnedReaderCycle({accounts:['owned','primary'],config,db:lateDb,nowMs:base+12*60000,clock:()=>base+15*60000,
 bridgeRunner:async(...args)=>{record985StreamState('heartbeat',lateDb,base+15*60000);await bridge(...args);},
 auditEvidenceProvider:async()=>({healthy:true,monitored:['primary'],tweetIds:[]})});
assert.equal(getXAccountCoverageSnapshot(['primary'],lateDb,env,base+15*60000).accounts[0].audit.status,'suspected_missing','late completion callback uses processing clock against recent SSE heartbeat');
lateDb.close();
const fairDb=new DatabaseSync(':memory:');initXPipelineDb(fairDb);
record985StreamState('connected',fairDb,base);
const attempted=[];
previousMinute=0;
for(const minute of [12,22,32]) {
 pulse(fairDb,previousMinute,minute);previousMinute=minute;
 if(minute>12) fairDb.prepare("update x_985_audit_state set status='suspected_missing' where username_key='audita'").run();
 const next=await runXOwnedReaderCycle({accounts:['owned','auditA','auditB','auditC'],config,db:fairDb,
  nowMs:base+minute*60000,clock:()=>base+minute*60000,
  auditEvidenceProvider:async()=>({healthy:true,monitored:['audita','auditb','auditc'],tweetIds:[]}),
  bridgeRunner:async(task,_config,onEvent)=>{
   attempted.push(task.accounts.filter(a=>a.purpose==='audit').map(a=>a.username));
   await onEvent({version:1,runId:task.runId,type:'cycle_complete'});
  }});
 assert.equal(next.auditAttempted,1,'distribute the hourly audit workload over ordinary cycles');
}
assert.deepEqual(attempted,[['audita'],['auditb'],['auditc']],'a failed audit does not monopolize the next slot');
fairDb.close();
const reconnectedDb=new DatabaseSync(':memory:');initXPipelineDb(reconnectedDb);
const auditWindows=[];
previousMinute=0;
for(const minute of [2,12]) {
 if(minute===2)record985StreamState('connected',reconnectedDb,base);
 pulse(reconnectedDb,previousMinute,minute);previousMinute=minute;
 await runXOwnedReaderCycle({accounts:['owned','primary'],config,db:reconnectedDb,
  nowMs:base+minute*60000,clock:()=>base+minute*60000,
  auditEvidenceProvider:async()=>({healthy:true,monitored:['primary'],tweetIds:[]}),
  bridgeRunner:async(task,_config,onEvent)=>{
   auditWindows.push(task.accounts.filter(a=>a.purpose==='audit').map(a=>a.fromAt));
   await onEvent({version:1,runId:task.runId,type:'cycle_complete'});
  }});
}
assert.deepEqual(auditWindows,[[],["2026-10-04T03:02:00.000Z"]],
 'wait for a usable 985 interval and keep recovery inside the subscription window');
reconnectedDb.close();
const interruptedDb=new DatabaseSync(':memory:');initXPipelineDb(interruptedDb);
establishMonitoring(interruptedDb);
record985StreamState('connected',interruptedDb,base);
pulse(interruptedDb,0,12);
const runInterrupted=(minute,bridgeRunner=bridge)=>runXOwnedReaderCycle({
 accounts:['owned','primary'],config,db:interruptedDb,nowMs:base+minute*60000,clock:()=>base+minute*60000,
 bridgeRunner,auditEvidenceProvider:async()=>({healthy:true,monitored:['primary'],tweetIds:[]}),
});
await runInterrupted(12);
const beforeGap=getXAccountCoverageSnapshot(['primary'],interruptedDb,env,base+12*60000).accounts[0].audit;
assert.equal(beforeGap.status,'suspected_missing');
assert.equal((await runInterrupted(17)).auditAttempted,0,'stale heartbeat cannot schedule an audit');
record985StreamState('heartbeat',interruptedDb,base+22*60000);
assert.equal((await runInterrupted(22)).auditAttempted,0,'resumed traffic does not erase the preceding heartbeat gap');
pulse(interruptedDb,22,32);
await runInterrupted(32,async(task,_config,onEvent)=>{
 assert.equal(task.accounts.find(account=>account.purpose==='audit').fromAt,new Date(base).toISOString(),'recovery can cover the earlier stream window');
 record985StreamState('connected',interruptedDb,base+32*60000+1);
 for(const account of task.accounts)await onEvent({version:1,runId:task.runId,type:'account_complete',username:account.username,userId:'321',complete:true,throughAt:account.throughAt,checkedAt:account.throughAt,pages:1,accepted:0,quarantined:0,reason:null,coverageKind:'posts-and-quotes',replyCoverageComplete:false,replyReason:'reply_page_budget_unavailable'});
 await onEvent({version:1,runId:task.runId,type:'cycle_complete'});
});
const interrupted=getXAccountCoverageSnapshot(['primary'],interruptedDb,env,base+32*60000).accounts[0].audit;
assert.equal(interrupted.status,'unavailable','a new SSE epoch invalidates the in-flight audit');
assert.equal(interrupted.lastSuccessfulCheckAt,beforeGap.lastSuccessfulCheckAt,'invalidated audit does not advance its proof checkpoint');
assert.equal(interrupted.confirmedMissingTweetId,null,'missing evidence from a previous epoch cannot promote the author');
interruptedDb.close();
const windowDb=new DatabaseSync(':memory:');initXPipelineDb(windowDb);
establishMonitoring(windowDb);
windowDb.prepare("update x_985_audit_state set last_successful_check_at=? where username_key='primary'").run(new Date(base+40*60000).toISOString());
windowDb.prepare("insert into x_985_audit_candidates values(?,?,?,?,?,1,'missing')")
 .run(item.id,'primary',item.createdAt,item.createdAt,item.createdAt);
const afterOldCandidate=prepare985AuditAccounts(['owned','primary'],['owned'],windowDb,base+50*60000,1,0,base+20*60000);
assert.equal(afterOldCandidate[0].fromAt,new Date(base).toISOString(),'a missing post from a prior stream window is still eligible for recovery');
record985RawPayload({content:{unknown:'format'}},windowDb,base+45*60000);
assert.equal(prepare985AuditAccounts(['owned','primary'],['owned'],windowDb,base+50*60000,1,0,base+20*60000).length,0,'wait for a useful post-fault window');
record985StreamState('connected',windowDb,base+20*60000);
pulse(windowDb,20,50);
const waiting=await runXOwnedReaderCycle({accounts:['owned','primary'],config,db:windowDb,nowMs:base+50*60000,
 auditEvidenceProvider:async()=>({healthy:true,monitored:['owned'],tweetIds:[]}),
 bridgeRunner:async(task,_config,onEvent)=>{await onEvent({version:1,runId:task.runId,type:'cycle_complete'});}});
assert.equal(waiting.auditAttempted,0,'membership checks do not spend X audit requests');
assert.equal(windowDb.prepare("select monitored_since_at from x_985_author_monitoring where username_key='primary'").get().monitored_since_at,null,
 'still observe an unfollow when a parse fault blocks X audits');
const afterFault=prepare985AuditAccounts(['owned','primary'],['owned'],windowDb,base+56*60000,1,0,base+20*60000);
assert.equal(afterFault[0].fromAt,new Date(base).toISOString(),'a parse fault does not erase the pending recovery window');
assert.equal(windowDb.prepare('select count(*) as n from x_985_audit_candidates').get().n,1,'preserve old evidence as history');
windowDb.close();
console.log('985 audit cycle: shared bridge, immediate recovery, independent confirmations and durable route/coverage passed.');
