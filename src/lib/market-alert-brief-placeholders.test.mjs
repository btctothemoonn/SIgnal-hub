import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openMarketAlertsStore} from './market-alerts-store.ts';
import {runMarketBriefCheck,parseMarketBriefResponse} from './market-alert-brief-worker.ts';

const now=Date.parse('2026-10-03T03:00:00Z');
const interval=10*60000;
const iso=ms=>new Date(ms).toISOString();
const env={MINIMAX_API_KEY:'fixture-key',AI_SUMMARY_MODEL:'MiniMax-M3'};
const current={scope:'3h',windowStart:iso(now-3*3600000),windowEnd:iso(now),generatedAt:null,checkedAt:iso(now),model:null,status:'ready',stale:false,headline:'规则概况',totals:{symbols:1,total:1,pump:1,crash:0,squeeze:0},risks:[],items:[{symbol:'AAAUSDT',pump:1,crash:0,squeeze:0,total:1,latestAt:iso(now-1000),latestPrice:1,latestChangePct:5,maxLevel:1,direction:'up',reason:'量价仍待确认。',figures:{fast:-.25,slow:.7,vol:1.1}}]};
const response=(reason,headline='等待量价配合。')=>JSON.stringify({summaries:[{scope:'3h',headline,items:[{symbol:'AAAUSDT',reason}]}]});

test('valid placeholders render live measurements while keeping the reusable template',()=>{
  const result=parseMarketBriefResponse(response('短周期 {fast}，量比 {vol}，继续观察。'),{'3h':current})[0].items[0];
  assert.equal(result.reasonTemplate,'短周期 {fast}，量比 {vol}，继续观察。');
  assert.equal(result.reason,'短周期 -0.25%，量比 1.10倍，继续观察。');
});

test('unknown, missing and malformed placeholders fall back as a complete sentence',()=>{
  for(const reason of ['量比 {price}，观察延续。','小时 {hour}，继续观察。','量比 {vol_x}，继续观察。']){
    const result=parseMarketBriefResponse(response(reason),{'3h':current})[0].items[0];
    assert.equal(result.reason,current.items[0].reason);
    assert.equal(result.reasonTemplate,current.items[0].reason);
  }
});

test('headline placeholders fall back without throwing away a valid item explanation',()=>{
  const result=parseMarketBriefResponse(response('量比 {vol}，等待确认。','量比 {vol} 值得关注。'),{'3h':current})[0];
  assert.equal(result.headline,'当前候选仍需按量价条件继续观察。');
  assert.equal(result.items[0].reason,'量比 1.10倍，等待确认。');
});

test('literal measurements and overlong prose cannot enter a reusable sentence',()=>{
  for(const reason of ['量比 2.5 倍，继续观察。','量比三倍，继续观察。','上涨百分之五，继续观察。','观察'.repeat(23)+'{vol}']){
    assert.equal(parseMarketBriefResponse(response(reason),{'3h':current})[0].items[0].reason,current.items[0].reason);
  }
});

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'market-brief-placeholders-'));
  const openStore=()=>openMarketAlertsStore(join(dir,'alerts.sqlite'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const refresh=(at,volume=1.1)=>{
    const store=openStore();
    for(const symbol of ['AAAUSDT','BBBUSDT']){
      store.upsertOpportunityEnrichment({symbol,metrics:{symbol,observedAt:iso(at-1000),stale:false,pct1m:.1,pct5m:.2,pct15m:.7,pct1h:6,pct24h:8,volumeRatio1m:1.1,volumeRatio5m:volume,oiGrowth15m:2,spotAvailable:true,alertCounts:{pump:1,crash:0,squeeze:0,total:1}},fetchedAt:iso(at-1000),stale:false,error:null});
    }
    store.close();
  };
  const store=openStore();
  for(const symbol of ['AAAUSDT','BBBUSDT'])store.insertMarketAlertEvent({id:symbol,symbol,type:'volatility',side:'LONG',level:1,stage:'test',trigger:'test',source:'ws',price:1,changePct:5,volumeRatio:3,score:null,metrics:{},reasons:[],occurredAt:iso(now-1000)});
  store.close();refresh(now);
  const read=(at)=>{const store=openStore();try{return store.readMarketBriefCache(at).reports;}finally{store.close();}};
  return{openStore,refresh,read};
}

function provider(calls,{template=true,reverse=true}={}){
  return async(_url,options)=>{
    const body=JSON.parse(options.body);
    const inputs=JSON.parse(body.messages[1].content.split('数据：')[1]);
    calls.push(inputs);
    const summaries=inputs.map(report=>({scope:report.scope,headline:'量价仍待配合。',items:(reverse?[...report.items].reverse():report.items).map(item=>({symbol:item.symbol,reason:report.scope==='3h'&&template?'量比 {vol}，等待量价确认。':'量价仍待确认。'}))}));
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summaries})}}]});
  };
}

test('AI priority order and live numbers survive reuse without another provider call',async(t)=>{
  const {openStore,refresh,read}=fixture(t);const calls=[];
  assert.equal((await runMarketBriefCheck({nowMs:now,openStore,env,fetchImpl:provider(calls)})).status,'generated');
  const first=read(now);
  assert.deepEqual(first['3h'].items.map(item=>item.symbol),['BBBUSDT','AAAUSDT']);
  assert.deepEqual(first['24h'].items.map(item=>item.symbol),['AAAUSDT','BBBUSDT'],'historical order remains the rule order');
  assert.equal(first['3h'].items[0].reasonTemplate,'量比 {vol}，等待量价确认。');
  assert.equal(first['3h'].items[0].reason,'量比 1.10倍，等待量价确认。');
  const projected=calls[0].find(report=>report.scope==='3h');
  for(const item of projected.items){
    assert.deepEqual(item.figures,[{key:'fast',label:'短周期涨跌'},{key:'slow',label:'较长周期涨跌'},{key:'vol',label:'短周期成交量比'},{key:'oi',label:'15分钟未平仓合约变化'}]);
    assert.equal(item.latestPrice,undefined);
    for(const figure of item.figures)assert.deepEqual(Object.keys(figure).sort(),['key','label']);
  }
  refresh(now+interval,1.2);
  assert.equal((await runMarketBriefCheck({nowMs:now+interval,openStore,env,fetchImpl:provider(calls)})).status,'unchanged');
  const reused=read(now+interval)['3h'];
  assert.deepEqual(reused.items.map(item=>item.symbol),['BBBUSDT','AAAUSDT']);
  assert.equal(reused.items[0].reason,'量比 1.20倍，等待量价确认。');
  assert.equal(reused.items[0].reasonTemplate,'量比 {vol}，等待量价确认。');
  assert.equal(reused.generatedAt,iso(now));
  assert.equal(calls.length,1);
});

test('a missing current template value prevents reuse and obtains safe fresh narration',async(t)=>{
  const {openStore,refresh,read}=fixture(t);const calls=[];
  await runMarketBriefCheck({nowMs:now,openStore,env,fetchImpl:provider(calls)});
  assert.equal(read(now)['3h'].items[0].reasonTemplate,'量比 {vol}，等待量价确认。');
  refresh(now+interval,1.2);
  const missingStore=()=>{
    const store=openStore();const getInput=store.getMarketBriefInput;
    return{...store,getMarketBriefInput(at){const reports=getInput(at);for(const item of reports['3h'].items)delete item.figures.vol;return reports;}};
  };
  assert.equal((await runMarketBriefCheck({nowMs:now+interval,openStore:missingStore,env,fetchImpl:provider(calls,{template:false})})).status,'generated');
  assert.equal(calls.length,2);
  assert.equal(read(now+interval)['3h'].items[0].reason,'量价仍待确认。');
});

test('legacy qualitative caches reuse without a reasonTemplate property',async(t)=>{
  const {openStore,refresh,read}=fixture(t);const calls=[];
  await runMarketBriefCheck({nowMs:now,openStore,env,fetchImpl:provider(calls,{template:false})});
  const reports=read(now);for(const scope of ['3h','24h'])for(const item of reports[scope].items)delete item.reasonTemplate;
  const store=openStore();store.saveMarketBriefCache(reports,'legacy',now);store.close();
  refresh(now+interval,1.2);
  assert.equal((await runMarketBriefCheck({nowMs:now+interval,openStore,env,fetchImpl:provider(calls)})).status,'unchanged');
  assert.equal(calls.length,1);
  assert.equal(read(now+interval)['3h'].items[0].reason,'量价仍待确认。');
});
