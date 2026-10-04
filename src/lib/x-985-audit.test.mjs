import assert from 'node:assert/strict';
import test from 'node:test';
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
for(const other of [{twAccount:'truth:someone',content:{}},{twAccount:'someone',content:{source:'truth'}},{eventType:'NEW_INSTAGRAM_POST',source:'instagram',twAccount:'instagram:khaokheow.zoo',content:{id:'unsafe-instagram-id',userScreenName:'khaokheow.zoo',source:'instagram'}},{twAccount:'instagram:complex',content:{platform:'instagram'}}])record985RawPayload(other,db,base+7*60000);
assert.equal(db.prepare('select count(*) as n from x_985_parse_fault').get().n,0,'known non-X platform events cannot disable Twitter confirmation');
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

const followerEvents=[
 {eventType:'NEW_FOLLOWER',twAccount:'media',content:{}},
 {eventType:'NEW_FOLLOWER',twAccount:'media',content:null},
 {eventType:'NEW_FOLLOWER',twAccount:'media',content:{id:'2106500000000000100',userScreenName:'media',text:'follower metadata is not a post receipt'}},
];
const cachedPosts=[
 mediaRaw,
 {eventType:'NEW_TWEET_QUOTE',twAccount:'media',content:{id:'2106500000000000101',userScreenName:'media',text:'public quote'}},
 {eventType:'NEW_TWEET_REPLY',twAccount:'media',content:{id:'2106500000000000102',userScreenName:'media',text:'public reply'}},
];
const cachedEvidence=events=>fetch985AuditEvidence({MONITOR985_ENABLED:'true'},async url=>
 Response.json(String(url).includes('watch-config')?{config:{twitter:['media']}}:{events}));

await test('known NEW_FOLLOWER events do not poison raw post receipts',()=>{
 const receiptsDb=new DatabaseSync(':memory:');initX985AuditDb(receiptsDb);
 try {
  for(const follower of followerEvents)record985RawPayload(follower,receiptsDb,base+31*60000);
  assert.equal(receiptsDb.prepare('select count(*) as n from x_985_parse_fault').get().n,0,'known follower metadata must not record a Twitter parse fault');
  assert.equal(receiptsDb.prepare('select count(*) as n from x_985_raw_observations').get().n,0,'a follower event must not become a post receipt even when its metadata resembles a tweet');
  for(const post of cachedPosts)record985RawPayload(post,receiptsDb,base+32*60000);
  assert.deepEqual(receiptsDb.prepare('select tweet_id from x_985_raw_observations order by tweet_id').all().map(row=>row.tweet_id),['2106500000000000002','2106500000000000101','2106500000000000102'],'real media, quote and reply receipt IDs remain recorded');
 } finally {receiptsDb.close();}
});

await test('cached NEW_FOLLOWER metadata leaves mixed public post evidence healthy',async()=>{
 const mixed=await cachedEvidence([followerEvents[0],cachedPosts[0],followerEvents[1],cachedPosts[1],followerEvents[2],cachedPosts[2]]);
 assert.equal(mixed.healthy,true,'known follower events must not disable an otherwise valid cached post audit');
 assert.deepEqual(mixed.tweetIds,['2106500000000000002','2106500000000000101','2106500000000000102'],'follower metadata must not supply receipt evidence');
 const followersOnly=await cachedEvidence(followerEvents);
 assert.equal(followersOnly.healthy,true,'an explicitly known non-post cache is a valid empty post result');
 assert.deepEqual(followersOnly.tweetIds,[],'no follower event proves receipt of a tweet');
});

await test('future non-post-looking events and malformed tweets still block absence evidence',async()=>{
 for(const unknown of [
  {eventType:'NEW_FOLLOWER_V2',twAccount:'media',content:{}},
  {eventType:'FUTURE_NON_POST_EVENT',twAccount:'media',content:{}},
  {eventType:'NEW_TWEET',twAccount:'media',content:{text:'unknown tweet structure'}},
 ]) {
  const mixed=await cachedEvidence([...cachedPosts,unknown,...followerEvents]);
  assert.equal(mixed.healthy,false,unknown.eventType+' must keep the upstream absence check unavailable');
  const faultsDb=new DatabaseSync(':memory:');initX985AuditDb(faultsDb);
  try {
   record985RawPayload(unknown,faultsDb,base+33*60000);
   assert.equal(faultsDb.prepare('select count(*) as n from x_985_parse_fault').get().n,1,unknown.eventType+' must record an unparsed upstream event');
   assert.equal(faultsDb.prepare('select count(*) as n from x_985_raw_observations').get().n,0,'unknown structures cannot prove receipt');
   record985RawPayload(followerEvents[0],faultsDb,base+34*60000);
   assert.equal(faultsDb.prepare('select occurred_at from x_985_parse_fault where id=1').get().occurred_at,'2026-10-04T03:33:00.000Z','ignoring known follower metadata must preserve an earlier unknown-event fault');
  } finally {faultsDb.close();}
 }
});
