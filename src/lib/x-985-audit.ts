import type { DatabaseSync } from 'node:sqlite';
import type { TwitterFeedItem, TwitterRealtimeUpdate } from './6551-twitter.ts';
import { getXPipelineDb } from './x-pipeline-store.ts';
import { normalizeXOwnedUsername } from './x-owned-reader-config.ts';
import { buildMonitor985RequestHeaders, buildMonitor985RequestUrl } from './monitor985-auth.ts';
import { parseMonitor985WatchConfig } from './monitor985-watch-config.ts';
import { extractMonitor985Events } from './monitor985.ts';

type Row=Record<string,unknown>;
export type X985AuditEvidence={healthy:boolean;monitored:string[];tweetIds:string[]};
const initialized=new WeakSet<DatabaseSync>();
const HOUR=3_600_000;
function validTweetId(id:string) {return /^[1-9]\d{0,19}$/.test(id) && BigInt(id)<=BigInt('18446744073709551615');}
function tableExists(db:DatabaseSync,name:string) {return Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name));}
export function initX985AuditDb(db:DatabaseSync=getXPipelineDb()) {
  if(initialized.has(db))return;
  db.exec(`
    create table if not exists x_985_raw_observations(tweet_id text primary key,username_key text not null,first_seen_at text not null,last_seen_at text not null);
    create table if not exists x_985_stream(id integer primary key check(id=1),connected_since_at text,last_activity_at text);
    create table if not exists x_985_audit_state(username_key text primary key,user_id text,last_attempt_at text,last_successful_check_at text,status text not null,reason text,checked_count integer not null default 0);
    create table if not exists x_985_audit_candidates(tweet_id text primary key,username_key text not null,created_at text not null,first_missing_at text not null,last_missing_at text not null,checks integer not null,status text not null);
    create table if not exists x_985_promotions(username_key text primary key,tweet_id text not null,created_at text not null,confirmed_at text not null,reason text not null);
    create table if not exists x_985_audit_control(id integer primary key check(id=1),last_sweep_at text not null);
    create table if not exists x_985_parse_fault(id integer primary key check(id=1),occurred_at text not null);
  `);initialized.add(db);
}
export function record985RawObservation(update:Pick<TwitterRealtimeUpdate,'account'|'feedItem'>,db:DatabaseSync=getXPipelineDb(),nowMs=Date.now()) {
  const item=update.feedItem;const username=normalizeXOwnedUsername(item.username);
  if(!username || !validTweetId(item.id) || item.profileUrl.startsWith('https://truthsocial.com/'))return;
  initX985AuditDb(db);const at=new Date(nowMs).toISOString();
  db.prepare(`insert into x_985_raw_observations values(?,?,?,?) on conflict(tweet_id) do update set last_seen_at=excluded.last_seen_at`).run(item.id,username,at,at);
}
function raw985Identity(raw:unknown):{id:string;username:string}|null {
  if(!raw || typeof raw!=='object')return null;
  const event=raw as Row;const content=event.content;
  if(!content || typeof content!=='object' || Array.isArray(content))return null;
  const tweet=content as Row;
  const id=typeof tweet.id==='string'?tweet.id:'';
  const username=normalizeXOwnedUsername(tweet.userScreenName || tweet.screenName || tweet.username || event.twAccount);
  if(!validTweetId(id) || !username)return null;
  if(event.twAccount && normalizeXOwnedUsername(event.twAccount)!==username)return null;
  return {id,username};
}
function isOtherPlatformPayload(raw:unknown) {
  if(!raw || typeof raw!=='object')return false;
  const event=raw as Row;const content=event.content && typeof event.content==='object' ? event.content as Row : {};
  const other=['truth','truthsocial','truth-social','instagram','threads','telegram','facebook','youtube','tiktok'];
  const sources=[event.source,content.source,content.platform].map(value=>String(value || '').toLowerCase());
  const prefix=String(event.twAccount || '').toLowerCase().split(':');
  return sources.some(source=>other.includes(source)) || (prefix.length>1 && other.includes(prefix[0])) || content.isInstagram===true;
}
export function record985RawPayload(raw:unknown,db:DatabaseSync=getXPipelineDb(),nowMs=Date.now()) {
  if(isOtherPlatformPayload(raw))return;
  initX985AuditDb(db);const identity=raw985Identity(raw);const at=new Date(nowMs).toISOString();
  if(identity)db.prepare(`insert into x_985_raw_observations values(?,?,?,?) on conflict(tweet_id) do update set last_seen_at=excluded.last_seen_at`).run(identity.id,identity.username,at,at);
  else db.prepare('insert into x_985_parse_fault values(1,?) on conflict(id) do update set occurred_at=excluded.occurred_at').run(at);
}
export function record985StreamState(state:'connected'|'heartbeat'|'disconnected',db:DatabaseSync=getXPipelineDb(),nowMs=Date.now()) {
  initX985AuditDb(db);const at=new Date(nowMs).toISOString();
  if(state==='connected')db.prepare(`insert into x_985_stream values(1,?,?) on conflict(id) do update set connected_since_at=excluded.connected_since_at,last_activity_at=excluded.last_activity_at`).run(at,at);
  else if(state==='disconnected')db.prepare(`insert into x_985_stream values(1,null,?) on conflict(id) do update set connected_since_at=null,last_activity_at=excluded.last_activity_at`).run(at);
  else db.prepare('update x_985_stream set last_activity_at=? where id=1 and connected_since_at is not null').run(at);
}
export function get985Promotions(db:DatabaseSync=getXPipelineDb()):string[] {
  return tableExists(db,'x_985_promotions') ? db.prepare('select username_key from x_985_promotions order by confirmed_at,username_key').all().map(row=>String(row.username_key)) : [];
}
export function get985AuditSnapshot(username:string,db:DatabaseSync=getXPipelineDb()) {
  if(!tableExists(db,'x_985_audit_state'))return null;
  const row=db.prepare('select * from x_985_audit_state where username_key=?').get(normalizeXOwnedUsername(username)) as Row|undefined;
  if(!row)return null;
  const promotion=db.prepare('select tweet_id,confirmed_at from x_985_promotions where username_key=?').get(normalizeXOwnedUsername(username)) as Row|undefined;
  return {status:String(row.status),reason:row.reason?String(row.reason):null,lastAttemptAt:row.last_attempt_at?String(row.last_attempt_at):null,lastSuccessfulCheckAt:row.last_successful_check_at?String(row.last_successful_check_at):null,checkedCount:Number(row.checked_count),confirmedMissingTweetId:promotion?String(promotion.tweet_id):null,promotedAt:promotion?String(promotion.confirmed_at):null};
}
export function prepare985AuditAccounts(usernames:readonly string[],owned:readonly string[],db:DatabaseSync,nowMs:number,batchLimit=7) {
  initX985AuditDb(db);const assigned=new Set(owned.map(normalizeXOwnedUsername));const at=new Date(nowMs).toISOString();
  const authors=[...new Set(usernames.map(normalizeXOwnedUsername).filter(Boolean))].filter(name=>!assigned.has(name));
  for(const name of authors)db.prepare("insert or ignore into x_985_audit_state(username_key,status) values(?,'never_checked')").run(name);
  const rows=authors.map(name=>db.prepare('select * from x_985_audit_state where username_key=?').get(name) as Row);
  const rechecks=rows.filter(row=>row.status==='suspected_missing' && nowMs-Date.parse(String(row.last_attempt_at))>=600_000).sort((a,b)=>String(a.last_attempt_at).localeCompare(String(b.last_attempt_at))).slice(0,2);
  const control=db.prepare('select last_sweep_at from x_985_audit_control where id=1').get() as Row|undefined;
  const due=!control || nowMs-Date.parse(String(control.last_sweep_at))>=HOUR;
  const selected=[...rechecks];
  if(due) {
    selected.push(...rows.filter(row=>!selected.includes(row)).sort((a,b)=>String(a.last_attempt_at || '').localeCompare(String(b.last_attempt_at || '')) || String(a.username_key).localeCompare(String(b.username_key))).slice(0,Math.max(0,batchLimit-selected.length)));
    db.prepare('insert into x_985_audit_control values(1,?) on conflict(id) do update set last_sweep_at=excluded.last_sweep_at').run(at);
  }
  return selected.map(row=>{
    const username=String(row.username_key);
    const missing=db.prepare("select min(created_at) as created_at from x_985_audit_candidates where username_key=? and status='missing'").get(username) as Row;
    let fromMs=row.last_successful_check_at ? Date.parse(String(row.last_successful_check_at))-900_000 : nowMs-8*HOUR;
    if(missing.created_at)fromMs=Math.min(fromMs,Date.parse(String(missing.created_at))-60_000);
    fromMs=Math.max(fromMs,nowMs-48*HOUR);
    db.prepare('update x_985_audit_state set last_attempt_at=? where username_key=?').run(at,username);
    return {username,...(row.user_id?{userId:String(row.user_id)}:{}),fromAt:new Date(Math.min(fromMs,nowMs-1)).toISOString(),throughAt:at,purpose:'audit' as const};
  });
}
export async function fetch985AuditEvidence(env:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch):Promise<X985AuditEvidence> {
  const unavailable={healthy:false,monitored:[],tweetIds:[]};
  if(!['true','1','yes','on'].includes((env.MONITOR985_ENABLED || 'true').toLowerCase()))return unavailable;
  const base=env.MONITOR985_BASE_URL?.trim() || 'https://985monitor.xyz';
  try {
    const values=await Promise.all(['/api/watch-config','/api/twitter-live-events?limit=500'].map(async path=>{
      const response=await fetcher(buildMonitor985RequestUrl(path,base,env),{headers:buildMonitor985RequestHeaders(env),cache:'no-store',signal:AbortSignal.timeout(10_000)});
      if(!response.ok)throw new Error('upstream_unavailable');return response.json();
    }));
    const monitored=parseMonitor985WatchConfig(values[0]).effectiveTwitter.map(a=>normalizeXOwnedUsername(a.handle));
    if(!values[1] || typeof values[1]!=='object' || !Array.isArray(values[1].events))return unavailable;
    const events=extractMonitor985Events(values[1]);
    const ids=events.filter(raw=>!isOtherPlatformPayload(raw)).map(raw985Identity);
    return {healthy:monitored.length>0 && ids.every(Boolean),monitored,tweetIds:ids.filter(Boolean).map(identity=>identity!.id)};
  } catch {return unavailable;}
}
export function complete985Audit(event:Record<string,unknown>,items:readonly TwitterFeedItem[],evidence:X985AuditEvidence,db:DatabaseSync,nowMs=Date.now()) {
  initX985AuditDb(db);const username=normalizeXOwnedUsername(event.username);const at=new Date(nowMs).toISOString();
  db.prepare("insert or ignore into x_985_audit_state(username_key,status) values(?,'never_checked')").run(username);
  const checkedAt=typeof event.checkedAt==='string'?event.checkedAt:at;
  const stream=db.prepare('select * from x_985_stream where id=1').get() as Row|undefined;
  const since=stream?.connected_since_at?Date.parse(String(stream.connected_since_at)):NaN;
  const active=stream?.last_activity_at?Date.parse(String(stream.last_activity_at)):NaN;
  const fault=db.prepare('select occurred_at from x_985_parse_fault where id=1').get() as Row|undefined;
  const faultAt=fault?Date.parse(String(fault.occurred_at)):NaN;
  const available=evidence.healthy && evidence.monitored.includes(username) && Number.isFinite(since) && Number.isFinite(active) && nowMs-active<=180_000 && active<=nowMs+60_000;
  let status=event.complete?'verified':'incomplete';let reason=event.complete?null:String(event.reason || 'account_missing_completion');const promotedIds:string[]=[];
  if(event.complete && !available) {status='unavailable';reason='upstream_evidence_unavailable';}
  if(event.complete && available) {
    for(const item of items) {
      const created=Date.parse(item.createdAt);
      if(normalizeXOwnedUsername(item.username)!==username || !Number.isFinite(created) || created<since || nowMs-created<600_000 || created>nowMs)continue;
      if(Number.isFinite(faultAt) && faultAt>=created) {status='unavailable';reason='upstream_event_unparsed';continue;}
      const raw=db.prepare('select 1 from x_985_raw_observations where tweet_id=? and username_key=?').get(item.id,username);
      const observed=tableExists(db,'x_feed_observations') && db.prepare("select 1 from x_feed_observations where tweet_id=? and source='monitor985' and lower(author_username)=?").get(item.id,username);
      const prior=db.prepare('select * from x_985_audit_candidates where tweet_id=?').get(item.id) as Row|undefined;
      if(raw || observed || evidence.tweetIds.includes(item.id)) {
        db.prepare("update x_985_audit_candidates set status='received' where tweet_id=?").run(item.id);
        if(!db.prepare('select 1 from x_feed where id=?').get(item.id)) {status='local_processing';reason='upstream_received_local_missing';}
        continue;
      }
      const separated=prior && nowMs-Date.parse(String(prior.last_missing_at))>=600_000;
      const checks=prior?.status==='missing' ? Number(prior.checks)+(separated?1:0) : 1;
      db.prepare(`insert into x_985_audit_candidates values(?,?,?,?,?,?,'missing') on conflict(tweet_id) do update set last_missing_at=case when ?=1 then excluded.last_missing_at else last_missing_at end,checks=excluded.checks,status='missing'`).run(item.id,username,item.createdAt,at,at,checks,separated?1:0);
      status='suspected_missing';reason='awaiting_second_check';
      if(checks>=2 && separated && nowMs-Date.parse(String(prior!.first_missing_at))>=600_000) {
        db.prepare("insert or ignore into x_985_promotions values(?,?,?,?,'confirmed_985_missing')").run(username,item.id,item.createdAt,at);
        promotedIds.push(item.id);status='confirmed_missing';reason='confirmed_985_missing';
      }
    }
  }
  db.prepare(`update x_985_audit_state set user_id=coalesce(?,user_id),status=?,reason=?,last_successful_check_at=case when ?=1 then ? else last_successful_check_at end,checked_count=checked_count+1 where username_key=?`).run(typeof event.userId==='string'?event.userId:null,status,reason,event.complete?1:0,checkedAt,username);
  return {status,reason,promotedIds};
}
