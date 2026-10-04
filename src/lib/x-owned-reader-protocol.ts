import { spawn } from "node:child_process";
import type { TwitterFeedItem } from "./6551-twitter.ts";
import { normalizeXOwnedUsername, type XOwnedReaderConfig } from "./x-owned-reader-config.ts";
import { safeXOwnedReason } from "./x-owned-reader-state.ts";

export type XOwnedReaderTaskAccount = {username:string;userId?:string;fromAt:string;throughAt:string};
export type XOwnedReaderTask = {version:1;runId:string;sessionDbPath:string;cooldownFilePath:string;maxRequests:number;deadlineMs:number;minIntervalMs:number;maxPages:number;accounts:XOwnedReaderTaskAccount[];mode?:"doctor"};
export type XOwnedReaderEvent = Record<string,unknown> & {version:1;runId:string;type:string;feedItem?:TwitterFeedItem;account?:{username:string;userId:string}};
const LINE_LIMIT=512*1024;
const OUTPUT_LIMIT=16*1024*1024;
const eventTypes=new Map([["NEW_TWEET","NEW_TWEET"],["NEW_TWEET_REPLY","NEW_TWEET_REPLY"],["NEW_TWEET_QUOTE","NEW_TWEET_QUOTE"],["tweet","NEW_TWEET"],["reply","NEW_TWEET_REPLY"],["quote","NEW_TWEET_QUOTE"]]);
const isoPattern=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function record(value:unknown):Record<string,unknown> { if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("protocol_invalid"); return value as Record<string,unknown>; }
function requireValid(condition:unknown):asserts condition { if (!condition) throw new Error("protocol_invalid"); }
function id(value:unknown):value is string { return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value) && BigInt(value)<=BigInt("18446744073709551615"); }
function iso(value:unknown):value is string { return typeof value === "string" && isoPattern.test(value) && Number.isFinite(Date.parse(value)); }
function validContentVersion(value:unknown) {return value===undefined || (typeof value==="string" && (/^\d{1,20}$/.test(value) && BigInt(value)<=BigInt("18446744073709551615") || iso(value)));}
function smallInt(value:unknown,max=Number.MAX_SAFE_INTEGER) { return Number.isSafeInteger(value) && Number(value)>=0 && Number(value)<=max; }
function validUrl(value:unknown,allowEmpty=false) { if(allowEmpty && value === "") return true; if(typeof value!=="string" || value.length>4096) return false; try { return ["http:","https:"].includes(new URL(value).protocol); } catch{return false;} }
function validTweetUrl(value:unknown,tweetId:string,username:string) { if (!validUrl(value)) return false; const url=new URL(String(value)); return /^(?:www\.)?(?:x|twitter)\.com$/i.test(url.hostname) && url.pathname.toLowerCase()===`/${username.toLowerCase()}/status/${tweetId}`; }
function validMedia(value:unknown) { return Array.isArray(value) && value.length<=20 && value.every(raw=>{const item=record(raw);return ["image","video","gif"].includes(String(item.kind)) && typeof item.mimeType === "string" && typeof item.label === "string" && validUrl(item.previewUrl) && (item.width===null || smallInt(item.width)) && (item.height===null || smallInt(item.height));}); }
function validQuote(value:unknown) { if(value===null) return true; const item=record(value); return id(item.id) && iso(item.createdAt) && normalizeXOwnedUsername(item.username) && typeof item.text === "string" && item.text.length<=200000 && typeof item.displayName === "string" && validUrl(item.profileUrl) && validUrl(item.userAvatar,true) && validTweetUrl(item.tweetUrl,String(item.id),String(item.username)) && validMedia(item.media) && (item.relation===undefined || item.relation==="quote" || item.relation==="reply") && (item.contentSource===undefined || item.contentSource==="owned-reader") && (item.contentComplete===undefined || typeof item.contentComplete==="boolean") && validContentVersion(item.contentVersion); }

export function validateXOwnedReaderEvent(raw:unknown,task:XOwnedReaderTask):XOwnedReaderEvent {
  const event=record(raw);
  requireValid(event.version===1 && event.runId===task.runId && typeof event.type === "string");
  const base={version:1 as const,runId:task.runId,type:event.type};
  if(event.type==="cycle_complete") return base;
  if(event.type==="error") return {...base,reason:safeXOwnedReason(event.reason,"bridge_failed")};
  if(event.type==="paused") { requireValid(event.nextRetryAt===null || iso(event.nextRetryAt)); return {...base,reason:safeXOwnedReason(event.reason,"bridge_failed"),nextRetryAt:event.nextRetryAt}; }
  if(event.type==="doctor") {
    requireValid(task.mode === "doctor" && event.protocolVersion===1 && typeof event.sdkVersion === "string" && /^\d+\.\d+\.\d+$/.test(event.sdkVersion) && typeof event.sessionAvailable === "boolean" && typeof event.coolingDown === "boolean" && (event.nextRetryAt===undefined || event.nextRetryAt===null || iso(event.nextRetryAt)));
    return {...base,protocolVersion:1,sdkVersion:event.sdkVersion,sessionAvailable:event.sessionAvailable,coolingDown:event.coolingDown,nextRetryAt:event.nextRetryAt || null};
  }
  requireValid(task.mode!=="doctor");
  if(event.type==="account_complete") {
    const username=normalizeXOwnedUsername(event.username);
    const account=task.accounts.find(item=>normalizeXOwnedUsername(item.username)===username);
    requireValid(account && id(event.userId) && (!account.userId || event.userId===account.userId));
    requireValid(typeof event.complete==="boolean" && iso(event.throughAt) && Date.parse(event.throughAt)===Date.parse(account.throughAt) && iso(event.checkedAt) && Date.parse(event.checkedAt)>=Date.parse(account.throughAt) && Date.parse(event.checkedAt)<=Date.now()+60000 && smallInt(event.pages,task.maxPages) && smallInt(event.accepted) && smallInt(event.quarantined));
    requireValid(!event.complete || (Number(event.pages)>0 && Number(event.quarantined)===0 && event.reason===null));
    requireValid(event.coverageKind==="posts-and-quotes" && typeof event.replyCoverageComplete === "boolean" && (event.replyCoverageComplete ? event.replyReason === null : typeof event.replyReason === "string"));
    const subscriberContentExcluded=event.subscriberContentExcluded===undefined ? 0 : event.subscriberContentExcluded;
    const subscriberExcludedTweetIds=event.subscriberExcludedTweetIds===undefined ? [] : event.subscriberExcludedTweetIds;
    requireValid(smallInt(subscriberContentExcluded,1000) && Array.isArray(subscriberExcludedTweetIds) && subscriberExcludedTweetIds.length===subscriberContentExcluded && subscriberExcludedTweetIds.every(id) && new Set(subscriberExcludedTweetIds).size===subscriberExcludedTweetIds.length);
    return {...base,username,userId:event.userId,complete:event.complete,throughAt:account.throughAt,checkedAt:event.checkedAt,pages:event.pages,accepted:event.accepted,quarantined:event.quarantined,reason:event.complete ? null : safeXOwnedReason(event.reason,"entry_quarantined"),coverageKind:"posts-and-quotes",replyCoverageComplete:event.replyCoverageComplete,replyReason:event.replyCoverageComplete ? null : safeXOwnedReason(event.replyReason,"reply_focal_unverified"),subscriberContentExcluded,subscriberExcludedTweetIds:[...subscriberExcludedTweetIds]};
  }
  requireValid(event.type==="tweet");
  const eventAccount=record(event.account);
  const username=normalizeXOwnedUsername(eventAccount.username);
  const account=task.accounts.find(item=>normalizeXOwnedUsername(item.username)===username);
  const item=record(event.feedItem);
  const evidence=record(event.evidence);
  requireValid(account && id(eventAccount.userId) && (!account.userId || eventAccount.userId===account.userId));
  requireValid(normalizeXOwnedUsername(item.username)===username && id(item.id) && iso(item.createdAt) && Date.parse(item.createdAt)>=Date.parse(account.fromAt) && Date.parse(item.createdAt)<=Date.parse(account.throughAt));
  requireValid(item.userId===undefined || item.userId===eventAccount.userId);
  requireValid(evidence.tweetId===item.id && evidence.userId===eventAccount.userId && typeof evidence.entryId === "string" && evidence.entryId.length>0 && evidence.entryId.length<=256 && ["TimelineTimelineItem","TimelineTimelineModule"].includes(String(evidence.entryType)) && ["standalone","focal"].includes(String(evidence.selection)) && typeof evidence.pinned === "boolean");
  requireValid(evidence.requestKind!=="TweetDetail" || evidence.requestedTweetId===item.id);
  requireValid(typeof item.text === "string" && item.text.length<=200000 && typeof item.displayName === "string" && validUrl(item.profileUrl) && validUrl(item.userAvatar,true) && validTweetUrl(item.tweetUrl,String(item.id),String(item.username)) && Array.isArray(item.hashtags) && item.hashtags.length<=100 && item.hashtags.every(tag=>typeof tag === "string") && [item.likes,item.retweets,item.replies,item.quotes,item.views].every(value=>smallInt(value)) && validMedia(item.media) && validQuote(item.quotedTweet));
  requireValid(item.contentComplete===true && item.contentSource==="owned-reader" && item.queryLabel==="owned-reader / full" && item.origin==="watch");
  requireValid(validContentVersion(item.contentVersion));
  requireValid(item.eventType===undefined || (typeof item.eventType==="string" && eventTypes.has(item.eventType)));
  const feedItem={id:String(item.id),text:item.text,createdAt:item.createdAt,username:String(item.username),displayName:item.displayName,profileUrl:String(item.profileUrl),userAvatar:String(item.userAvatar),tweetUrl:String(item.tweetUrl),hashtags:item.hashtags,likes:Number(item.likes),retweets:Number(item.retweets),replies:Number(item.replies),quotes:Number(item.quotes),views:Number(item.views),media:item.media,quotedTweet:item.quotedTweet,origin:"watch",queryLabel:"owned-reader / full",translation:null,contentSource:"owned-reader",contentComplete:true} as TwitterFeedItem;
  if(item.contentVersion!==undefined)feedItem.contentVersion=item.contentVersion as string;
  if(typeof item.eventType==="string")feedItem.eventType=eventTypes.get(item.eventType);
  return {...base,account:{username,userId:String(eventAccount.userId)},feedItem,evidence};
}

export async function runOwnedReaderBridge(task:XOwnedReaderTask,config:XOwnedReaderConfig,onEvent:(event:XOwnedReaderEvent)=>unknown|Promise<unknown>):Promise<void> {
  return new Promise((resolve,reject)=>{
    const childEnv={...process.env};delete childEnv.X_OWNED_READER_SESSION_DB;delete childEnv.X_OWNED_READER_COOLDOWN_FILE;
    const child=spawn(config.pythonPath,[config.bridgePath],{shell:false,stdio:["pipe","pipe","pipe"],env:childEnv,windowsHide:true});
    let buffer="";let bytes=0;let complete=false;let failed=false;let chain=Promise.resolve();
    const fail=(reason:string)=>{if(failed)return;failed=true;clearTimeout(timer);child.kill("SIGTERM");reject(new Error(safeXOwnedReason(reason,"bridge_failed")));};
    // The bridge enforces the unchanged network deadline and needs time to close SDK locks.
    const timer=setTimeout(()=>fail("bridge_timeout"),task.deadlineMs+5000);
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    const line=(value:string)=>{if(!value.trim())return;if(Buffer.byteLength(value)>LINE_LIMIT){fail("bridge_line_limit");return;}let event:XOwnedReaderEvent;try{event=validateXOwnedReaderEvent(JSON.parse(value),task);if(complete)throw new Error("protocol_invalid");if(event.type==="cycle_complete")complete=true;}catch{fail("protocol_invalid");return;}chain=chain.then(()=>{if(!failed)return onEvent(event);}).then(()=>undefined);chain.catch(()=>fail("feed_write_failed"));};
    child.stdout.on("data",(data:string)=>{if(failed)return;bytes+=Buffer.byteLength(data);if(bytes>OUTPUT_LIMIT){fail("bridge_output_limit");return;}buffer+=data;let newline;while((newline=buffer.indexOf("\n"))>=0){const next=buffer.slice(0,newline);buffer=buffer.slice(newline+1);line(next);if(failed)return;}if(Buffer.byteLength(buffer)>LINE_LIMIT)fail("bridge_line_limit");});
    child.on("error",()=>fail("bridge_failed"));child.stdin.on("error",()=>fail("bridge_failed"));
    child.on("close",(code)=>{if(failed)return;if(buffer.trim())line(buffer);if(failed)return;void chain.then(()=>{if(failed)return;clearTimeout(timer);if(code!==0)fail("bridge_failed");else if(!complete)fail("bridge_missing_completion");else resolve();}).catch(()=>fail("feed_write_failed"));});
    child.stdin.end(JSON.stringify(task));
  });
}
