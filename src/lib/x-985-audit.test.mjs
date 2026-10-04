import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initXPipelineDb } from './x-pipeline-store.ts';
import { initX985AuditDb, record985RawObservation, record985RawPayload, fetch985AuditEvidence, record985StreamState, prepare985AuditAccounts, complete985Audit, get985AuditSnapshot, get985Promotions } from './x-985-audit.ts';

const db=new DatabaseSync(':memory:');initXPipelineDb(db);initX985AuditDb(db);
const base=Date.parse('2026-10-04T03:00:00Z');
const item={id:'2106500000000000000',username:'Primary',displayName:'Primary',text:'public post',createdAt:new Date(base+60000).toISOString(),profileUrl:'https://x.com/Primary',userAvatar:'',tweetUrl:'https://x.com/Primary/status/2106500000000000000',hashtags:[],likes:0,retweets:0,replies:0,quotes:0,views:0,media:[],quotedTweet:null,origin:'watch',queryLabel:'owned-reader / full',translation:null,contentSource:'owned-reader',contentComplete:true};
const evidence={healthy:true,monitored:['primary'],tweetIds:[]};
const completion={username:'primary',userId:'321',complete:true,checkedAt:new Date(base+12*60000).toISOString(),throughAt:new Date(base+12*60000).toISOString(),reason:null};
record985StreamState('connected',db,base);
record985StreamState('heartbeat',db,base+12*60000);
assert.deepEqual(complete985Audit(completion,[item],evidence,db,base+12*60000).promotedIds,[],'one missing sample is not confirmation');
assert.equal(get985AuditSnapshot('primary',db).status,'suspected_missing');
record985StreamState('heartbeat',db,base+17*60000);
assert.deepEqual(complete985Audit({...completion,checkedAt:new Date(base+17*60000).toISOString()},[item],evidence,db,base+17*60000).promotedIds,[],'five-minute repeat cannot confirm');
record985StreamState('heartbeat',db,base+22*60000);
const confirmed=complete985Audit({...completion,checkedAt:new Date(base+22*60000).toISOString(),throughAt:new Date(base+22*60000).toISOString()},[item],evidence,db,base+22*60000);
assert.deepEqual(confirmed.promotedIds,[item.id]);
assert.deepEqual(get985Promotions(db),['primary']);
assert.equal(get985AuditSnapshot('primary',db).status,'confirmed_missing');

for(const [name,changes,gate] of [
 ['young',{createdAt:new Date(base+16*60000).toISOString()},evidence],
 ['old',{createdAt:new Date(base-60000).toISOString()},evidence],
 ['upstream',{}, {...evidence,tweetIds:[item.id]}],
 ['offline',{}, {...evidence,healthy:false}],
 ['unmonitored',{}, {...evidence,monitored:[]}],
]) {
 const value={...item,username:name,tweetUrl:`https://x.com/${name}/status/${item.id}`};
 const account={...completion,username:name};
 const context={...gate,monitored:gate.monitored.length?[name]:[]};
 for(let n=0;n<2;n++) {record985StreamState('heartbeat',db,base+(17+n*5)*60000);complete985Audit({...account,checkedAt:new Date(base+(17+n*5)*60000).toISOString()},[{...value,...changes}],context,db,base+(17+n*5)*60000);}
 assert.equal(get985Promotions(db).includes(name),false,name+' must not migrate');
}
const raw={...item,id:'2106500000000000001',username:'received',tweetUrl:'https://x.com/received/status/2106500000000000001'};
record985RawObservation({account:'received',feedItem:raw},db,base+2*60000);
record985StreamState('heartbeat',db,base+23*60000);
complete985Audit({...completion,username:'received'},[raw],{...evidence,monitored:['received']},db,base+23*60000);
assert.equal(get985AuditSnapshot('received',db).status,'local_processing','raw985 seen but no feed is a local fault');
record985StreamState('disconnected',db,base+24*60000);
complete985Audit({...completion,username:'broken'},[{...item,username:'broken'}],{...evidence,monitored:['broken']},db,base+24*60000);
assert.equal(get985Promotions(db).includes('broken'),false);
complete985Audit({...completion,username:'incomplete',complete:false,reason:'page_limit_reached'},[],evidence,db,base+25*60000);
assert.equal(get985AuditSnapshot('incomplete',db).status,'incomplete');

const authors=Array.from({length:42},(_,i)=>'author'+i);
const first=prepare985AuditAccounts(authors,[],db,base,21);
assert.equal(prepare985AuditAccounts(authors,[],db,base+300000,21).length,0,'routine sweep does not run every five minutes');
const second=prepare985AuditAccounts(authors,[],db,base+3600000,21);
assert.equal(first.length,21);assert.equal(second.length,21);
assert.equal(new Set([...first,...second].map(a=>a.username)).size,42,'rotation includes all authors');
assert.ok(first.every(a=>a.purpose==='audit'));
assert.equal(prepare985AuditAccounts(['primary'],get985Promotions(db),db,base,21).length,0,'promoted authors are no longer audited as primary');
const mediaRaw={eventType:'NEW_TWEET',twAccount:'media',content:{id:'2106500000000000002',userScreenName:'media',text:''}};
const fetcher=async url=>Response.json(String(url).includes('watch-config')?{config:{twitter:['media']}}:{events:[mediaRaw]});
const mediaEvidence=await fetch985AuditEvidence({MONITOR985_ENABLED:'true'},fetcher);
assert.equal(mediaEvidence.healthy,true);assert.deepEqual(mediaEvidence.tweetIds,[mediaRaw.content.id],'receipt ID survives empty media caption');
record985RawPayload(mediaRaw,db,base+5*60000);
assert.equal(db.prepare('select username_key from x_985_raw_observations where tweet_id=?').get(mediaRaw.content.id).username_key,'media');
for(const unknown of [{},{events:[{eventType:'NEW_TWEET',content:{text:'unknown format'}}]}]) {
 const malformed=await fetch985AuditEvidence({MONITOR985_ENABLED:'true'},async url=>Response.json(String(url).includes('watch-config')?{config:{twitter:['media']}}:unknown));
 assert.equal(malformed.healthy,false,'HTTP200 unknown payload cannot prove absence');
}
const unsafeId={...mediaRaw,content:{...mediaRaw.content,id:'99999999999999999999'}};
assert.equal((await fetch985AuditEvidence({MONITOR985_ENABLED:'true'},async url=>Response.json(String(url).includes('watch-config')?{config:{twitter:['media']}}:{events:[unsafeId]}))).healthy,false,'uint64 overflow cannot establish healthy upstream evidence');
record985RawPayload(unsafeId,db,base+7*60000);
assert.equal(db.prepare('select 1 from x_985_raw_observations where tweet_id=?').get(unsafeId.content.id),undefined);
db.prepare('delete from x_985_parse_fault').run();
for(const truth of [{twAccount:'truth:someone',content:{}},{twAccount:'someone',content:{source:'truth'}}])record985RawPayload(truth,db,base+7*60000);
assert.equal(db.prepare('select count(*) as n from x_985_parse_fault').get().n,0,'normal Truth events cannot disable Twitter confirmation');
record985RawPayload({content:{unexpected:'schema'}},db,base+8*60000);
record985StreamState('connected',db,base);record985StreamState('heartbeat',db,base+30*60000);
complete985Audit({...completion,username:'parsefault'},[{...item,username:'parsefault',id:'2106500000000000003'}],{healthy:true,monitored:['parsefault'],tweetIds:[]},db,base+30*60000);
assert.equal(get985AuditSnapshot('parsefault',db).reason,'upstream_event_unparsed');
db.close();
const rotationDb=new DatabaseSync(':memory:');initXPipelineDb(rotationDb);
const checked=[];
for(let hour=0;hour<6;hour++) {
 const batch=prepare985AuditAccounts(authors,[],rotationDb,base+hour*3600000);
 assert.equal(batch.length,7);checked.push(...batch.map(account=>account.username));
 assert.equal(prepare985AuditAccounts(authors,[],rotationDb,base+hour*3600000+300000).length,0);
}
assert.equal(new Set(checked).size,42,'default hourly seven-person cadence covers all 42 in six hours');rotationDb.close();
console.log('985 audit: two independent confirmations, raw-vs-local failure, time/health/watchlist gates and fair rotation passed.');
