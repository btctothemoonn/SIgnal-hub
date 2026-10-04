import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initXPipelineDb, getXPipelineFeedItem } from "./x-pipeline-store.ts";
import { getXOwnedReaderConfig } from "./x-owned-reader-config.ts";
import { runXOwnedReaderCycle } from "./x-owned-reader-cycle.ts";
import { getXAccountCoverageSnapshot, getXOwnedReaderAccountState, initXOwnedReaderStateDb } from "./x-owned-reader-state.ts";

const db=new DatabaseSync(":memory:");initXPipelineDb(db);
const config=getXOwnedReaderConfig({X_OWNED_READER_ENABLED:"true",X_OWNED_READER_SESSION_DB:"/private/session.db",X_OWNED_READER_COOLDOWN_FILE:"/private/cooldown.json"});
const now=Date.parse("2026-10-04T02:00:00Z");
const item={id:"1987654321098765432",text:"The first complete body has the original statement.",createdAt:"2026-10-04T01:50:00Z",username:"PhotonCap",displayName:"PhotonCap",profileUrl:"https://x.com/PhotonCap",userAvatar:"",tweetUrl:"https://x.com/PhotonCap/status/1987654321098765432",hashtags:[],likes:0,retweets:0,replies:0,quotes:0,views:0,media:[],quotedTweet:null,origin:"watch",queryLabel:"owned-reader / full",translation:null,contentSource:"owned-reader",contentComplete:true,contentVersion:"1",eventType:"NEW_TWEET_REPLY",inReplyToTweetId:"1987654321098765000",inReplyToUsername:"Other"};
const evidence={entryId:`tweet-${item.id}`,entryType:"TimelineTimelineItem",selection:"focal",tweetId:item.id,userId:"321",pinned:false,requestKind:"TweetDetail",requestedTweetId:item.id};
async function collect(feedItem,startedAt) {
  return runXOwnedReaderCycle({accounts:["photoncap"],config,db,nowMs:startedAt,bridgeRunner:async(task,_config,onEvent)=>{
    await onEvent({version:1,runId:task.runId,type:"tweet",account:{username:"photoncap",userId:"321"},feedItem,evidence:{...evidence,tweetId:feedItem.id,entryId:`tweet-${feedItem.id}`,requestedTweetId:feedItem.id}});
    await onEvent({version:1,runId:task.runId,type:"account_complete",username:"photoncap",userId:"321",complete:true,throughAt:task.accounts[0].throughAt,checkedAt:new Date(startedAt+1000).toISOString(),pages:1,accepted:1,quarantined:0,reason:null,coverageKind:"posts-and-quotes",replyCoverageComplete:false,replyReason:"reply_focal_unverified"});
    await onEvent({version:1,runId:task.runId,type:"cycle_complete"});
  }});
}
assert.equal((await collect(item,now)).completed,1);
assert.equal(getXPipelineFeedItem(item.id,db).contentVersion,"1","validated edit evidence must persist through the ingestion protocol");
assert.equal(getXPipelineFeedItem(item.id,db).eventType,"NEW_TWEET_REPLY","an explicit reply stays a reply without a parsed parent object");
const edited={...item,text:"Corrected body.",contentVersion:"2"};
assert.equal((await collect(edited,now+300000)).completed,1);
assert.equal(getXPipelineFeedItem(item.id,db).text,"Corrected body.");
assert.equal(getXPipelineFeedItem(item.id,db).contentVersion,"2");
assert.equal(getXPipelineFeedItem(item.id,db).eventType,"NEW_TWEET_REPLY");
assert.equal(db.prepare("select count(*) as n from x_feed").get().n,1);
assert.equal((await collect(item,now+600000)).completed,1);
assert.equal(getXPipelineFeedItem(item.id,db).text,"Corrected body.","late revision one cannot regress revision two");
const quotedTweet={id:"1987654321098765000",text:"Verified complete quoted context.",createdAt:"2026-10-03T01:00:00Z",username:"Other",displayName:"Other",profileUrl:"https://x.com/Other",userAvatar:"",tweetUrl:"https://x.com/Other/status/1987654321098765000",media:[],translation:null,relation:"quote",contentSource:"owned-reader",contentComplete:true,contentVersion:"3"};
const quoteItem={...item,id:"1987654321098766000",createdAt:"2026-10-04T02:12:00Z",tweetUrl:"https://x.com/PhotonCap/status/1987654321098766000",eventType:"NEW_TWEET_QUOTE",quotedTweet};
assert.equal((await collect(quoteItem,now+900000)).completed,1);
const savedQuote=getXPipelineFeedItem(quoteItem.id,db).quotedTweet;
assert.equal(savedQuote.contentSource,"owned-reader");assert.equal(savedQuote.contentComplete,true);assert.equal(savedQuote.contentVersion,"3");
const excludedId="1987654321098767000";
const exclusionResult=await runXOwnedReaderCycle({accounts:["photoncap"],config,db,nowMs:now+1200000,bridgeRunner:async(task,_config,onEvent)=>{
  await onEvent({version:1,runId:task.runId,type:"account_complete",username:"photoncap",userId:"321",complete:true,throughAt:task.accounts[0].throughAt,checkedAt:"2026-10-04T02:20:01Z",pages:1,accepted:0,quarantined:0,reason:null,coverageKind:"posts-and-quotes",replyCoverageComplete:false,replyReason:"reply_focal_unverified",subscriberContentExcluded:1,subscriberExcludedTweetIds:[excludedId]});
  await onEvent({version:1,runId:task.runId,type:"cycle_complete"});
}});
assert.equal(exclusionResult.completed,1);
assert.equal(getXOwnedReaderAccountState("photoncap",db).subscriberContentExcluded,1);
assert.deepEqual(getXOwnedReaderAccountState("photoncap",db).subscriberExcludedTweetIds,[excludedId]);
const exclusionSnapshot=getXAccountCoverageSnapshot(["photoncap"],db,{X_OWNED_READER_ENABLED:"true"},now+1201000);
assert.equal(exclusionSnapshot.accounts[0].subscriberContentExcluded,1);assert.deepEqual(exclusionSnapshot.accounts[0].subscriberExcludedTweetIds,[excludedId]);
assert.equal(exclusionSnapshot.accounts[0].coveredThroughAt,"2026-10-04T02:20:00.000Z");
assert.equal(getXPipelineFeedItem(excludedId,db),null,"subscription previews must not be inserted as complete originals");
const excludedRow=db.prepare("select subscriber_content_excluded,subscriber_excluded_tweet_ids_json from x_owned_reader_state where username_key='photoncap'").get();
assert.equal(excludedRow.subscriber_content_excluded,1);assert.deepEqual(JSON.parse(excludedRow.subscriber_excluded_tweet_ids_json),[excludedId]);
db.close();

const legacyDb=new DatabaseSync(":memory:");initXPipelineDb(legacyDb);
legacyDb.exec("create table x_owned_reader_state(username_key text primary key,username text not null,updated_at text not null)");
initXOwnedReaderStateDb(legacyDb);
legacyDb.prepare("insert into x_owned_reader_state(username_key,username,updated_at) values('photoncap','photoncap','2026-10-04T02:00:00Z')").run();
assert.equal(getXOwnedReaderAccountState("photoncap",legacyDb).subscriberContentExcluded,0);assert.deepEqual(getXOwnedReaderAccountState("photoncap",legacyDb).subscriberExcludedTweetIds,[]);legacyDb.close();
console.log("Owned protocol-to-store: edit revision survives ingestion and updates full body; explicit reply without a parent remains a reply; older edit cannot regress it.");
