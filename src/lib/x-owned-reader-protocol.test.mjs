import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getXOwnedReaderConfig } from "./x-owned-reader-config.ts";
import { validateXOwnedReaderEvent, runOwnedReaderBridge } from "./x-owned-reader-protocol.ts";

const task={version:1,runId:"safe-run",sessionDbPath:"/private/session.db",cooldownFilePath:"/private/cooldown.json",maxRequests:80,deadlineMs:200,minIntervalMs:2000,maxPages:5,accounts:[{username:"photoncap",userId:"321",fromAt:"2026-10-02T02:00:00Z",throughAt:"2026-10-04T02:00:00Z"}]};
const feedItem={id:"1987654321098765432",text:"complete original post",createdAt:"2026-10-04T01:00:00Z",username:"PhotonCap",displayName:"PhotonCap",profileUrl:"https://x.com/PhotonCap",userAvatar:"",tweetUrl:"https://x.com/PhotonCap/status/1987654321098765432",hashtags:[],likes:1,retweets:2,replies:3,quotes:4,views:5,media:[],quotedTweet:null,origin:"watch",queryLabel:"owned-reader / full",translation:null,contentSource:"owned-reader",contentComplete:true};
const tweet={version:1,runId:"safe-run",type:"tweet",account:{username:"photoncap",userId:"321"},feedItem,evidence:{entryId:"tweet-1987654321098765432",entryType:"TimelineTimelineItem",selection:"standalone",tweetId:feedItem.id,userId:"321",pinned:false}};
assert.equal(validateXOwnedReaderEvent(tweet,task).feedItem.id,feedItem.id);
assert.equal(validateXOwnedReaderEvent({version:1,runId:task.runId,type:'cycle_complete',requests:7},task).requests,7);
assert.throws(()=>validateXOwnedReaderEvent({version:1,runId:task.runId,type:'cycle_complete',requests:81},task),/protocol_invalid/);
assert.equal(validateXOwnedReaderEvent({...tweet,feedItem:{...feedItem,contentVersion:"2",eventType:"NEW_TWEET_REPLY"}},task).feedItem.contentVersion,"2");
assert.equal(validateXOwnedReaderEvent({...tweet,feedItem:{...feedItem,contentVersion:"2026-10-04T01:30:00Z",eventType:"reply"}},task).feedItem.eventType,"NEW_TWEET_REPLY");
for(const invalidVersion of ["not-edit-proof", -1, "18446744073709551616", "2026-90-90T00:00:00Z"])assert.throws(()=>validateXOwnedReaderEvent({...tweet,feedItem:{...feedItem,contentVersion:invalidVersion}},task),/protocol_invalid/);
assert.throws(()=>validateXOwnedReaderEvent({...tweet,feedItem:{...feedItem,eventType:"NEW_RETWEET"}},task),/protocol_invalid/);
const quotedTweet={id:"1987654321098765000",text:"Verified complete quoted context.",createdAt:"2026-10-03T01:00:00Z",username:"Other",displayName:"Other",profileUrl:"https://x.com/Other",userAvatar:"",tweetUrl:"https://x.com/Other/status/1987654321098765000",media:[],translation:null,relation:"quote",contentSource:"owned-reader",contentComplete:true,contentVersion:"3"};
assert.equal(validateXOwnedReaderEvent({...tweet,feedItem:{...feedItem,quotedTweet}},task).feedItem.quotedTweet.contentVersion,"3");
for(const badQuote of [{...quotedTweet,contentVersion:"not-edit-proof"},{...quotedTweet,contentComplete:"true"},{...quotedTweet,contentSource:"Cookie=private"}])assert.throws(()=>validateXOwnedReaderEvent({...tweet,feedItem:{...feedItem,quotedTweet:badQuote}},task),/protocol_invalid/);
assert.throws(()=>validateXOwnedReaderEvent({...tweet,evidence:{...tweet.evidence,requestKind:"TweetDetail",requestedTweetId:"111"}},task),/protocol_invalid/);
assert.equal(validateXOwnedReaderEvent({...tweet,evidence:{...tweet.evidence,requestKind:"TweetDetail",requestedTweetId:feedItem.id}},task).feedItem.id,feedItem.id);
for(const malformed of [ {...tweet,version:2},{...tweet,runId:"foreign"},{...tweet,account:{username:"other",userId:"321"}},{...tweet,feedItem:{...feedItem,username:"parentAuthor"}},{...tweet,evidence:{...tweet.evidence,userId:"other"}},{...tweet,feedItem:{...feedItem,id:"NaN"}},{...tweet,feedItem:{...feedItem,createdAt:"2026-10-05T01:00:00Z"}},{...tweet,evidence:{...tweet.evidence,selection:"parent"}} ]) assert.throws(()=>validateXOwnedReaderEvent(malformed,task), /protocol_invalid/);
const complete={version:1,runId:"safe-run",type:"account_complete",username:"photoncap",userId:"321",complete:true,throughAt:"2026-10-04T02:00:00Z",checkedAt:"2026-10-04T02:01:00Z",pages:1,accepted:1,quarantined:0,reason:null,coverageKind:"posts-and-quotes",replyCoverageComplete:false,replyReason:"reply_focal_unverified"};
assert.equal(validateXOwnedReaderEvent(complete,task).complete,true);
const excludedCompletion={...complete,subscriberContentExcluded:1,subscriberExcludedTweetIds:["1987654321098765000"]};
assert.equal(validateXOwnedReaderEvent(excludedCompletion,task).subscriberContentExcluded,1);
assert.deepEqual(validateXOwnedReaderEvent(excludedCompletion,task).subscriberExcludedTweetIds,["1987654321098765000"]);
assert.equal(validateXOwnedReaderEvent(complete,task).subscriberContentExcluded,0,"older bridge fixtures without exclusion metadata default to zero");
for(const malformedExcluded of [
  {...excludedCompletion,subscriberContentExcluded:-1},
  {...excludedCompletion,subscriberContentExcluded:1.5},
  {...excludedCompletion,subscriberContentExcluded:"1"},
  {...excludedCompletion,subscriberContentExcluded:2},
  {...excludedCompletion,subscriberExcludedTweetIds:["invalid-id"]},
  {...excludedCompletion,subscriberExcludedTweetIds:["18446744073709551616"]},
  {...excludedCompletion,subscriberContentExcluded:2,subscriberExcludedTweetIds:["1987654321098765000","1987654321098765000"]},
  {...excludedCompletion,subscriberExcludedTweetIds:null},
])assert.throws(()=>validateXOwnedReaderEvent(malformedExcluded,task),/protocol_invalid/);
assert.throws(()=>validateXOwnedReaderEvent({...complete,throughAt:"2026-10-04T03:00:00Z"},task),/protocol_invalid/);
assert.throws(()=>validateXOwnedReaderEvent({...complete,pages:6},task),/protocol_invalid/);
assert.equal(validateXOwnedReaderEvent({version:1,runId:"safe-run",type:"error",reason:"Cookie=private"},task).reason,"bridge_failed");
const directory=await mkdtemp(join(tmpdir(),"owned-bridge-test-"));
try {
  const path=join(directory,"fake.mjs");
  const config={...getXOwnedReaderConfig({}),pythonPath:process.execPath,bridgePath:path};
  await writeFile(path, `process.stdin.resume();process.stdin.on('end',()=>{ console.log(${JSON.stringify(JSON.stringify(tweet))});console.log(${JSON.stringify(JSON.stringify(complete))});console.log(JSON.stringify({version:1,runId:'safe-run',type:'cycle_complete'})); });`);
  const stored=[]; await runOwnedReaderBridge(task,config,event=>stored.push(event));
  assert.deepEqual(stored.map(event=>event.type),["tweet","account_complete","cycle_complete"]);
  // Python keeps the request deadline; allow its finally blocks to close the SDK session.
  await writeFile(path, "let input='';process.stdin.on('data',data=>input+=data);process.stdin.on('end',()=>{const task=JSON.parse(input);if(task.deadlineMs!==200)process.exit(1);setTimeout(()=>console.log(JSON.stringify({version:1,runId:task.runId,type:'cycle_complete'})),350);});");
  const cleanupEvents=[];await runOwnedReaderBridge(task,config,event=>cleanupEvents.push(event));
  assert.deepEqual(cleanupEvents.map(event=>event.type),["cycle_complete"]);
  for(const [source,expected] of [
    ["process.stderr.write('/private/session.db token=secret');console.log('bad JSON');","protocol_invalid"],
    ["console.log(JSON.stringify({version:1,runId:'safe-run',type:'error',reason:'session_unavailable'}));","bridge_missing_completion"],
    ["process.stdout.write('x'.repeat(524289));","bridge_line_limit"],
    ["process.stdin.resume();setTimeout(()=>{},10000);","bridge_timeout"],
  ]) {
    await writeFile(path,source);
    await assert.rejects(runOwnedReaderBridge(task,config,()=>{}),error=>error.message===expected && !error.message.includes("private"));
  }
} finally { await rm(directory,{recursive:true,force:true}); }
console.log("Owned protocol: bounded real child JSONL, identity/time/evidence validation, safe errors, missing completion and timeout passed.");
