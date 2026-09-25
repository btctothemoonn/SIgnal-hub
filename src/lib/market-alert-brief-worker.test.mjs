import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openMarketAlertsStore} from './market-alerts-store.ts';
import {runMarketBriefCheck,parseMarketBriefResponse} from './market-alert-brief-worker.ts';

const dir=mkdtempSync(join(tmpdir(),'market-brief-worker-'));
const now=Date.parse('2026-09-18T06:00:00Z');
const interval=10*60000;
const iso=ms=>new Date(ms).toISOString();
const env={MINIMAX_API_KEY:'test',AI_SUMMARY_MODEL:'MiniMax-M3'};
const makeStore=name=>()=>openMarketAlertsStore(join(dir,`${name}.sqlite`));
function alert(store,symbol,id,at) {
  store.insertMarketAlertEvent({id,symbol,type:'volatility',side:'LONG',level:2,stage:'test',trigger:'test',source:'ws',price:1,changePct:5,volumeRatio:3,score:null,metrics:{},reasons:[],occurredAt:iso(at)});
}
function enrich(store,symbol,at,overrides={}) {
  const metrics={symbol,observedAt:iso(at),stale:false,pct1m:0.1,pct5m:0.2,pct15m:0.7,pct1h:6,pct24h:8,volumeRatio1m:1.1,volumeRatio5m:1.1,oiGrowth15m:2,oiNotional:10000000,funding:0.0001,basis:0.001,globalLongShortRatio:1,topTraderLongShortRatio:1,takerBuySellRatio:1.2,spotAvailable:true,spotChange15m:3,spotVolumeRatio5m:2,perpSpotDivergencePct:1,distanceFromHighPct:-0.5,distanceFromLowPct:6,priorRunUpPct:7,supportBreak:false,lowerStructure:false,breakout20:false,quoteVolume:100000000,marketCapUsd:500000000,fdvUsd:1000000000,alertCounts:{pump:1,crash:0,squeeze:0,total:1},...overrides};
  store.upsertOpportunityEnrichment({symbol,metrics,fetchedAt:iso(at),stale:false,error:null});
}
function read(openStore,at) {
  const db=openStore();
  try{return db.readMarketBriefCache(at).reports;}finally{db.close();}
}
function explanation(reports) {
  return {summaries:reports.filter(report=>report.items.length).map(report=>({scope:report.scope,headline:report.scope==='3h'?'短时走势仍需持续观察。':'本监控样本的预警方向较集中。',items:report.items.map(item=>({symbol:item.symbol,reason:'异动尚未完全冷却，等待量价重新配合。'}))}))};
}
function transport(log,{fail=false}={}) {
  return async(_url,options)=>{
    const request=JSON.parse(options.body);
    const reports=JSON.parse(request.messages[1].content.split('数据：')[1]);
    const tracking=reports.find(report=>report.scope==='3h');
    if(tracking){
      assert.equal(tracking.totals,undefined,'current qualitative prose must not use changing raw counts');
      assert.equal(tracking.items[0].latestPrice,undefined,'trigger price is not current evidence');
      assert.deepEqual(Object.keys(tracking.items[0].tracking).sort(),['evidence','state'],'only fingerprinted categorical facts may inform cached prose');
      assert.ok(tracking.items[0].tracking.evidence.every(fact=>!/[0-9%]/.test(fact)),'numeric evidence stays on the live rules display');
    }
    const retrospective=reports.find(report=>report.scope==='24h');
    if(retrospective){
      assert.deepEqual(Object.keys(retrospective).sort(),['items','scope','totals']);
      assert.deepEqual(Object.keys(retrospective.items[0]).sort(),['crash','direction','maxLevel','pump','squeeze','symbol','total']);
    }
    log.push(reports.map(report=>report.scope));
    assert.equal(request.model,'MiniMax-M3');
    assert.equal(request.thinking.type,'disabled');
    if(fail)return new Response('{}',{status:429});
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(explanation(reports))}}]});
  };
}

try {
  // Counts do not make an empty tracking list eligible for an AI explanation.
  const parserStore=makeStore('parser');
  const parserDb=parserStore();
  alert(parserDb,'OLDUSDT','old',now-2*3600000);
  const parserInputs=parserDb.getMarketBriefInput(now);
  parserDb.close();
  parserInputs['3h'].items=[];
  const valid=explanation([parserInputs['24h']]);
  assert.equal(parseMarketBriefResponse(JSON.stringify(valid),parserInputs).length,1);
  const forged=structuredClone(valid);forged.summaries[0].items[0].symbol='FAKEUSDT';
  assert.throws(()=>parseMarketBriefResponse(JSON.stringify(forged),parserInputs),/symbol/);
  for(const unsafe of ['上涨百分之五，继续观察。','上涨5%，继续观察。','已经三连涨，继续观察。','目标价五美元，继续观察。','观察'.repeat(60)]){
    const numeric=structuredClone(valid);numeric.summaries[0].items[0].reason=unsafe;
    const safe=parseMarketBriefResponse(JSON.stringify(numeric),parserInputs)[0];
    assert.equal(safe.items[0].reason,parserInputs['24h'].items[0].reason,'unsafe prose falls back to current deterministic text');
    assert.equal(safe.headline,valid.summaries[0].headline,'valid AI fields survive another field being discarded');
  }
  for(const bad of ['',null,3]){
    const missing=structuredClone(valid);missing.summaries[0].items[0].reason=bad;
    assert.throws(()=>parseMarketBriefResponse(JSON.stringify(missing),parserInputs),/text/);
    const missingHeadline=structuredClone(valid);missingHeadline.summaries[0].headline=bad;
    assert.throws(()=>parseMarketBriefResponse(JSON.stringify(missingHeadline),parserInputs),/text/);
  }
  const longHeadline=structuredClone(valid);longHeadline.summaries[0].headline='观察'.repeat(60);
  assert.equal(parseMarketBriefResponse(JSON.stringify(longHeadline),parserInputs)[0].headline,'历史预警回顾，触发次数不代表当前强度。');
  const entirelyBad=structuredClone(valid);entirelyBad.summaries[0].headline='五个强势币种';entirelyBad.summaries[0].items[0].reason='上涨5%';
  assert.throws(()=>parseMarketBriefResponse(JSON.stringify(entirelyBad),parserInputs),/text/,'an entirely unusable response must remain a failure');
  const duplicate=structuredClone(valid);duplicate.summaries.push(duplicate.summaries[0]);
  assert.throws(()=>parseMarketBriefResponse(JSON.stringify(duplicate),parserInputs),/count/);
  const oldScope=structuredClone(valid);oldScope.summaries[0].scope='1h';
  assert.throws(()=>parseMarketBriefResponse(JSON.stringify(oldScope),parserInputs),/shape/);

  // MiniMax live response: an opening quote is omitted from both items keys,
  // while otherwise useful explanations are mixed with numeric headlines.
  const malformedStore=makeStore('provider-shape');
  const malformedDb=malformedStore();alert(malformedDb,'AAAUSDT','malformed',now-1000);enrich(malformedDb,'AAAUSDT',now-1000);malformedDb.close();
  const malformed='{ "summaries":[{"scope":"3h","headline":"三条等待确认的异动跟踪，短周期信号仍在反复",items":[{"symbol":"AAAUSDT","reason":"短周期信号仍在反复，等待量价重新配合。"}]},{"scope":"24h","headline":"历史预警以拉升为主、回落次之，仅现一条轧空预警",items":[{"symbol":"AAAUSDT","reason":"历史预警以上涨为主，仍需等待后续确认。"}]}]}';
  let malformedCalls=0;
  const malformedResult=await runMarketBriefCheck({nowMs:now,openStore:malformedStore,env,fetchImpl:async()=>{malformedCalls++;return Response.json({choices:[{finish_reason:'stop',message:{content:malformed}}]});}});
  assert.equal(malformedResult.status,'generated');
  assert.equal(malformedCalls,1,'field fallback and narrow JSON repair must not call the provider again');
  const repaired=read(malformedStore,now);
  assert.equal(repaired['3h'].headline,'当前候选仍需按量价条件继续观察。');
  assert.equal(repaired['24h'].headline,'历史预警回顾，触发次数不代表当前强度。');
  assert.equal(repaired['3h'].items[0].reason,'短周期信号仍在反复，等待量价重新配合。');
  const malformedInputsDb=malformedStore();const malformedInputs=malformedInputsDb.getMarketBriefInput(now);malformedInputsDb.close();
  assert.throws(()=>parseMarketBriefResponse(malformed.replace('AAAUSDT','FAKEUSDT'),malformedInputs),/symbol/,'repair never relaxes symbol validation');
  assert.throws(()=>parseMarketBriefResponse(malformed.replace('"24h"','"3h"'),malformedInputs),/shape/,'repair never relaxes scope uniqueness');
  assert.throws(()=>parseMarketBriefResponse(malformed.replace('"reason":','reason:'),malformedInputs),SyntaxError,'unobserved malformed JSON is not broadly guessed');

  const openStore=makeStore('refresh');
  const seed=openStore();alert(seed,'AAAUSDT','first',now-1000);enrich(seed,'AAAUSDT',now-1000);seed.close();
  const calls=[];
  const fetchImpl=transport(calls);
  assert.equal((await runMarketBriefCheck({nowMs:now,openStore,env,fetchImpl})).status,'generated');
  assert.deepEqual(calls,[['3h','24h']],'both changed windows use one request');
  const first=read(openStore,now);
  assert.equal(first['3h'].generatedAt,iso(now));
  assert.equal(first['3h'].items[0].symbol,'AAAUSDT');
  assert.ok(first['3h'].items[0].tracking);
  assert.equal((await runMarketBriefCheck({nowMs:now+1000,openStore,env,fetchImpl})).status,'cooldown');
  assert.equal((await runMarketBriefCheck({nowMs:now+interval-1,openStore,env,fetchImpl})).nextCheckAt,now+interval);

  // Stable bands reuse prose while evidence and timestamps reflect this check.
  const jitter=openStore();enrich(jitter,'AAAUSDT',now+interval-1000,{pct5m:0.25,pct15m:0.75});jitter.close();
  assert.equal((await runMarketBriefCheck({nowMs:now+interval,openStore,env,fetchImpl})).status,'unchanged');
  const stable=read(openStore,now+interval);
  assert.equal(calls.length,1);
  assert.equal(stable['3h'].items[0].tracking.observedAt,iso(now+interval-1000));
  assert.notDeepEqual(stable['3h'].items[0].tracking.evidence,first['3h'].items[0].tracking.evidence);
  assert.equal(stable['3h'].items[0].reason,first['3h'].items[0].reason);
  assert.equal(stable['3h'].generatedAt,iso(now));

  // New candidates trigger only the current list; retrospective AI keeps its own cadence.
  const changed=openStore();alert(changed,'BBBUSDT','second',now+2*interval-1000);enrich(changed,'BBBUSDT',now+2*interval-1000);enrich(changed,'AAAUSDT',now+2*interval-1000);changed.close();
  assert.equal((await runMarketBriefCheck({nowMs:now+2*interval,openStore,env,fetchImpl})).status,'generated');
  assert.deepEqual(calls[1],['3h']);
  assert.equal(read(openStore,now+2*interval)['24h'].totals.total,2);

  // A failed explanation must never resurrect removed candidates or their evidence.
  const removal=openStore();enrich(removal,'AAAUSDT',now+3*interval-1000,{stale:true});enrich(removal,'BBBUSDT',now+3*interval-1000,{stale:true});alert(removal,'CCCUSDT','third',now+3*interval-1000);enrich(removal,'CCCUSDT',now+3*interval-1000);removal.close();
  assert.equal((await runMarketBriefCheck({nowMs:now+3*interval,openStore,env,fetchImpl:transport(calls,{fail:true})})).status,'error');
  const failed=read(openStore,now+3*interval)['3h'];
  assert.deepEqual(failed.items.map(item=>item.symbol),['CCCUSDT']);
  assert.equal(failed.status,'error');
  assert.equal(failed.stale,false,'fresh rule data remains fresh after an AI failure');
  assert.equal(failed.model,null);assert.equal(failed.generatedAt,null);
  assert.ok(failed.items[0].tracking.nextWatch);
  assert.equal((await runMarketBriefCheck({nowMs:now+3*interval+1000,openStore,env,fetchImpl})).status,'cooldown');
  const retry=openStore();enrich(retry,'CCCUSDT',now+4*interval-1000);retry.close();
  assert.equal((await runMarketBriefCheck({nowMs:now+4*interval,openStore,env,fetchImpl})).status,'generated');
  assert.deepEqual(calls[3],['3h'],'failed unchanged evidence retries at the next scheduled check');

  // Updating the retrospective facts must not slide its original narration deadline.
  assert.equal((await runMarketBriefCheck({nowMs:now+3*3600000,openStore,env,fetchImpl})).status,'generated');
  assert.deepEqual(calls[4],['24h']);

  const concurrentStore=makeStore('concurrent');
  const batch=concurrentStore();alert(batch,'AAAUSDT','batch',now-1000);enrich(batch,'AAAUSDT',now-1000);batch.close();
  const concurrentCalls=[];
  const concurrent=await Promise.all([runMarketBriefCheck({nowMs:now,openStore:concurrentStore,env,fetchImpl:transport(concurrentCalls)}),runMarketBriefCheck({nowMs:now,openStore:concurrentStore,env,fetchImpl:transport(concurrentCalls)})]);
  assert.equal(concurrentCalls.length,1,'claim prevents concurrent duplicate AI calls');
  assert.deepEqual(concurrent.map(result=>result.status).sort(),['cooldown','generated']);
  const emptyStore=makeStore('empty');
  assert.equal((await runMarketBriefCheck({nowMs:now,openStore:emptyStore,env,fetchImpl:async()=>{throw new Error('empty windows must not call AI');}})).status,'empty');
} finally {rmSync(dir,{recursive:true,force:true});}
