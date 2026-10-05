import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initXPipelineDb,getXPipelineFeedItem } from './x-pipeline-store.ts';
import { getXOwnedReaderConfig } from './x-owned-reader-config.ts';
import { getXAccountCoverageSnapshot } from './x-owned-reader-state.ts';
import { runXOwnedReaderCycle } from './x-owned-reader-cycle.ts';
import { record985StreamState, prepare985AuditAccounts, sync985AuthorMonitoringEvidence } from './x-985-audit.ts';

const db=new DatabaseSync(':memory:');initXPipelineDb(db);
const base=Date.parse('2026-10-04T03:00:00Z');
const env={X_OWNED_READER_ENABLED:'true',X_985_AUDIT_ENABLED:'true',X_OWNED_READER_USERNAMES:'owned',X_OWNED_READER_SESSION_DB:'/private/account.db',X_OWNED_READER_COOLDOWN_FILE:'/private/cooldown.json'};
const config=getXOwnedReaderConfig(env);
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
for(const minute of [12,17,22]) {
 record985StreamState('heartbeat',db,base+minute*60000);
 await runXOwnedReaderCycle({accounts:['owned','primary'],config,db,nowMs:base+minute*60000,clock:()=>base+minute*60000,bridgeRunner:bridge,auditEvidenceProvider:async()=>({healthy:true,monitored:['primary'],tweetIds:[]})});
 if(minute<22)assert.equal(getXPipelineFeedItem(item.id,db),null,'audit does not silently turn all primary authors into VPS collectors');
}
assert.equal(tasks[0].accounts[0].username,'owned','production authors have priority');
assert.equal(tasks[0].accounts[1].purpose,'audit');
assert.equal(tasks[1].accounts.length,1,'no routine rescan after five minutes');
assert.equal(getXPipelineFeedItem(item.id,db).text,item.text,'confirmed missing item immediately committed');
const snapshot=getXAccountCoverageSnapshot(['owned','primary'],db,env,base+22*60000);
assert.equal(snapshot.accounts[1].route,'owned-reader');
assert.equal(snapshot.accounts[1].routeReason,'confirmed_985_missing');
assert.equal(snapshot.accounts[1].audit.confirmedMissingTweetId,item.id);
await runXOwnedReaderCycle({accounts:['owned','primary'],config,db,nowMs:base+27*60000,bridgeRunner:bridge,auditEvidenceProvider:async()=>{throw new Error('not due');}});
assert.equal(tasks.at(-1).accounts.length,2);
assert.ok(tasks.at(-1).accounts.every(account=>!account.purpose),'persisted promotion is included without env restart');
db.close();
const lateDb=new DatabaseSync(':memory:');initXPipelineDb(lateDb);
establishMonitoring(lateDb);
record985StreamState('connected',lateDb,base);
record985StreamState('heartbeat',lateDb,base+15*60000);
await runXOwnedReaderCycle({accounts:['owned','primary'],config,db:lateDb,nowMs:base+12*60000,clock:()=>base+15*60000,bridgeRunner:bridge,auditEvidenceProvider:async()=>({healthy:true,monitored:['primary'],tweetIds:[]})});
assert.equal(getXAccountCoverageSnapshot(['primary'],lateDb,env,base+15*60000).accounts[0].audit.status,'suspected_missing','late completion callback uses processing clock against recent SSE heartbeat');
lateDb.close();
console.log('985 audit cycle: shared bridge, primary samples not ingested, confirmation raw commit and durable route/coverage passed.');
