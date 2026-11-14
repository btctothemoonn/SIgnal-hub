import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initXPipelineDb, getXPipelineFeedItem } from './x-pipeline-store.ts';
import { getXOwnedReaderConfig } from './x-owned-reader-config.ts';
import { getXAccountCoverageSnapshot, pauseXOwnedReader } from './x-owned-reader-state.ts';
import { record985StreamState } from './x-985-audit.ts';
import { runXOwnedReaderCycle } from './x-owned-reader-cycle.ts';
import { get985FailoverStatus } from './x-985-failover.ts';

const db = new DatabaseSync(':memory:');
initXPipelineDb(db);
const base = Date.parse('2026-11-13T00:00:00Z');
const env = { MONITOR985_ENABLED:'true', X_OWNED_READER_ENABLED:'true', X_985_AUDIT_ENABLED:'true', X_OWNED_READER_USERNAMES:'owned',
  X_OWNED_READER_INTERVAL_MS:'960000', X_OWNED_READER_SESSION_DB:'/private/session.db', X_OWNED_READER_COOLDOWN_FILE:'/private/absent.json' };
const config = getXOwnedReaderConfig(env);
const accounts = ['owned','a','b','c','d','e','f'];
const tasks = [];
async function bridge(task, _config, emit) {
  tasks.push(task);
  for (const a of task.accounts) {
    if (a.username==='a') {
      const id='2121239068063457521';
      await emit({version:1,runId:task.runId,type:'tweet',account:{username:'a',userId:'321'},
        feedItem:{id,username:'a',displayName:'A',text:'verified fallback post',createdAt:new Date(base+5*60000).toISOString(),
          profileUrl:'https://x.com/a',userAvatar:'',tweetUrl:`https://x.com/a/status/${id}`,hashtags:[],likes:0,retweets:0,
          replies:0,quotes:0,views:0,media:[],quotedTweet:null,origin:'watch',queryLabel:'owned-reader / full',translation:null,
          contentSource:'owned-reader',contentComplete:true},
        evidence:{tweetId:id,userId:'321',entryId:`tweet-${id}`,entryType:'TimelineTimelineItem',selection:'standalone',pinned:false}});
    }
    await emit({ version:1, runId:task.runId, type:'account_complete', username:a.username,
    userId:'321', complete:true, throughAt:a.throughAt, checkedAt:a.throughAt, pages:1, accepted:0, quarantined:0,
    reason:null, coverageKind:'posts-and-quotes', replyCoverageComplete:false, replyReason:'reply_page_budget_unavailable' });
  }
  await emit({version:1,runId:task.runId,type:'cycle_complete',requests:10});
}
const cycle = (minutes, opts={}) => runXOwnedReaderCycle({accounts,config,db,nowMs:base+minutes*60000,
  clock:()=>base+minutes*60000,bridgeRunner:bridge,auditEvidenceProvider:async()=>({healthy:false,monitored:[],tweetIds:[]}),...opts});
record985StreamState('disconnected', db, base);
await cycle(1);
assert.equal(tasks.at(-1).accounts.length,1,'short outage must not start takeover');
record985StreamState('disconnected',db,base+9*60000);
const first = await cycle(16);
assert.deepEqual(tasks.at(-1).accounts.filter(a=>a.purpose==='failover').map(a=>a.username),['a','b','c','d'], 'sustained outage adds bounded fallback authors');
assert.equal(tasks.at(-1).maxRequests,80,'fallback shares the existing request budget');
assert.equal(first.failoverCompleted,4);
assert.equal(first.completed,1,'fallback does not inflate primary readiness counts');
assert.equal(getXPipelineFeedItem('2121239068063457521',db).contentSource,'owned-reader');
const snap=getXAccountCoverageSnapshot(accounts,db,env,base+16*60000);
assert.equal(snap.failover.active,true);
assert.equal(snap.accounts.find(a=>a.username==='a').route,'monitor985','takeover is temporary');
assert.equal(snap.accounts.find(a=>a.username==='a').temporaryCollector,'owned-reader');
assert.equal(db.prepare('select count(*) n from x_985_promotions').get().n,0);
await cycle(32);
assert.deepEqual(tasks.at(-1).accounts.filter(a=>a.purpose==='failover').map(a=>a.username),['e','f','a','b'],'round robin progresses across cycles');
assert.equal(db.prepare("select count(*) n from x_feed where id='2121239068063457521'").get().n,1,'repeated recovery deduplicates');
assert.equal(tasks.at(-1).accounts.find(a=>a.username==='a').fromAt,new Date(base+60000).toISOString(),'successful checkpoint overlaps fifteen minutes');
const before=tasks.length;
pauseXOwnedReader('rate_limited',new Date(base+60*60000).toISOString(),db,base+33*60000);
await cycle(48);
assert.equal(tasks.length,before,'global cooldown prevents ALL network requests');
record985StreamState('connected',db,base+64*60000);
await cycle(64);
assert.ok(tasks.at(-1).accounts.every(a=>a.purpose!=='failover'),'fresh stream exits takeover immediately');
assert.equal(getXAccountCoverageSnapshot(accounts,db,env,base+64*60000).failover.active,false);
// No heartbeat for over ten minutes also qualifies; no restart is required.
await cycle(80);
assert.equal(tasks.at(-1).accounts.filter(a=>a.purpose==='failover').length,4);
const staleSince=get985FailoverStatus(db,base+80*60000).unavailableSinceAt;
record985StreamState('disconnected',db,base+81*60000);
assert.equal(get985FailoverStatus(db,base+81*60000).active,true,'explicit disconnect must not reset an existing heartbeat outage');
assert.equal(get985FailoverStatus(db,base+81*60000).unavailableSinceAt,staleSince);
await cycle(96,{config:{...config,failoverEnabled:false}});
assert.ok(tasks.at(-1).accounts.every(a=>a.purpose!=='failover'));
db.close();
console.log('985 bounded failover: activation, rotation, checkpoints, recovery and cooldown passed');
