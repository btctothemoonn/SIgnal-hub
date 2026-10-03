import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const {openMarketAlertsStore}=await import('./market-alerts-store.ts');
const {marketBriefReportFingerprint}=await import('./market-alert-brief-store.ts');
const {marketBriefTemplateKeys,renderMarketBriefTemplate}=await import('./market-alert-brief-types.ts');
const {deriveOpportunityMetrics}=await import('./market-opportunity-enrichment.ts');
// Real template rendering must format only declared live measurements, never
// leave missing or malformed placeholders on the user-facing report.
assert.equal(renderMarketBriefTemplate('短线 {fast}，长线 {slow}，量比 {vol}，小时 {hour}，距高点 {dist}，持仓 {oi}',{fast:1.234,slow:-2.345,vol:2.4,hour:6.95,dist:-.7,oi:0}),'短线 +1.23%，长线 -2.35%，量比 2.40倍，小时 +6.95%，距高点 0.70%，持仓 +0.00%');
assert.equal(renderMarketBriefTemplate('等待量价配合。',undefined),'等待量价配合。');
assert.deepEqual(marketBriefTemplateKeys('{fast} 和 {vol} 再看 {fast}'),['fast','vol']);
for(const [template,figures] of [
  ['小时 {hour}',{fast:1}],
  ['短线 {fast}',{fast:null}],
  ['短线 {fast}',{fast:NaN}],
  ['短线 {fast}',{fast:Infinity}],
  ['短线 {fast}',Object.create({fast:1})],
  ['未知 {price}',{price:2}],
  ['量比 {volatility}',{volatility:2}],
  ['短线 {fast',{fast:1}],
  ['短线 fast}',{fast:1}],
  ['短线 {fast-pct}',{fast:1}],
  ['短线 {{fast}}',{fast:1}],
]) assert.equal(renderMarketBriefTemplate(template,figures),null,`unavailable or malformed template: ${template}`);
const dir=mkdtempSync(join(tmpdir(),'market-brief-'));
const path=join(dir,'alerts.sqlite');
let store=openMarketAlertsStore(path);
const now=Date.parse('2026-09-18T02:00:00Z');
const minute=60000;
function event(id,symbol,ago,side='LONG',type='volatility') {
  return {id,symbol,type,side,level:1,stage:'test',trigger:'test',source:'ws',price:1,changePct:5,volumeRatio:3,score:null,metrics:{},reasons:[],occurredAt:new Date(now-ago).toISOString()};
}
function enrich(symbol, patch={}, age=0, extra={}) {
  const at=new Date(now-age).toISOString();
  const metrics={symbol,observedAt:at,stale:false,pct1m:.3,pct5m:2,pct15m:4,pct1h:5,pct24h:10,volumeRatio1m:2,volumeRatio5m:2,oiGrowth15m:3,oiNotional:10000000,funding:0,basis:0,globalLongShortRatio:1,topTraderLongShortRatio:1,takerBuySellRatio:1.2,spotAvailable:false,spotChange15m:null,spotVolumeRatio5m:null,perpSpotDivergencePct:null,distanceFromHighPct:1,distanceFromLowPct:5,priorRunUpPct:10,supportBreak:false,lowerStructure:false,breakout20:true,quoteVolume:10000000,marketCapUsd:null,fdvUsd:null,alertCounts:{pump:1,crash:0,squeeze:0,total:1},...patch};
  store.upsertOpportunityEnrichment({symbol,metrics,fetchedAt:at,stale:false,error:null,...extra});
}
try {
  for(let i=0;i<250;i++) store.insertMarketAlertEvent(event(`old${i}`,'OLDUSDT',120*minute+i));
  store.insertMarketAlertEvent(event('fresh','FRESHUSDT',2*minute)); enrich('FRESHUSDT');
  store.insertMarketAlertEvent(event('fade','FADEUSDT',5*minute)); enrich('FADEUSDT',{pct5m:.2,volumeRatio5m:1.1,breakout20:false});
  store.insertMarketAlertEvent(event('stale','STALEUSDT',minute)); enrich('STALEUSDT',{},21*minute);
  store.insertMarketAlertEvent(event('missing','MISSINGUSDT',minute));
  store.insertMarketAlertEvent(event('reverse','REVERSEUSDT',minute)); enrich('REVERSEUSDT',{pct5m:-2,pct15m:-3});
  store.insertMarketAlertEvent(event('boundary','BOUNDARYUSDT',180*minute));
  store.insertMarketAlertEvent(event('future','FUTUREUSDT',-minute));
  const input=store.getMarketBriefInput(now);
  assert.equal(input['3h'].totals.total,255,'aggregate full window, not paginated feed');
  assert.equal(input['24h'].totals.total,256,'strict window boundary; future event excluded');
  assert.deepEqual(input['3h'].items.map(x=>x.symbol),['FRESHUSDT','FADEUSDT'],'fresh confirmed data outranks alert spam; stale/missing/reversed excluded');
  assert.equal(input['24h'].items[0].symbol,'OLDUSDT','historical frequency retained in retrospective');
  assert.equal(input['3h'].items[0].tracking.state,'new');
  assert.equal(input['3h'].items[1].tracking.state,'waiting');
  assert.equal(input['3h'].items[0].tracking.evidence.length,2);
  assert.deepEqual(input['3h'].items[0].figures,{fast:2,slow:4,vol:2,oi:3},'legacy impulse measurements keep distinct fast and slow values; hourly and distance require closed-candle context');
  assert.ok(input['24h'].items.every(item=>item.figures===undefined),'historical review cannot expose live tracking measurements');
  assert.match(input['3h'].items[0].tracking.evidence.join(' '),/2\.00/);
  assert.match(input['3h'].items[0].tracking.nextWatch,/5.*15/);
  const reversed=structuredClone(input['3h']);
  reversed.items.reverse();
  assert.equal(marketBriefReportFingerprint(input['3h']),marketBriefReportFingerprint(reversed),'AI priority order must not make unchanged current-list facts look new');
  assert.deepEqual(reversed.items.map(item=>item.symbol),['FADEUSDT','FRESHUSDT'],'fingerprinting must not replace the user-visible AI order');
  const newFigures=structuredClone(input['3h']);
  newFigures.items[0].figures={fast:2.05,slow:4.05,vol:2.05,oi:3.05};
  newFigures.items[0].reasonTemplate='短线 {fast}，量比 {vol}。';
  newFigures.items[0].reason='短线 +2.05%，量比 2.05倍。';
  assert.equal(marketBriefReportFingerprint(input['3h']),marketBriefReportFingerprint(newFigures),'live figures and narration must not invalidate reusable categorical facts');
  const changedSignal=structuredClone(input['3h']);
  changedSignal.items[0].tracking.signalKey+='changed';
  assert.notEqual(marketBriefReportFingerprint(input['3h']),marketBriefReportFingerprint(changedSignal),'a changed tracking fact must still refresh narration');
  const historyReversed=structuredClone(input['24h']);
  historyReversed.items.reverse();
  assert.notEqual(marketBriefReportFingerprint(input['24h']),marketBriefReportFingerprint(historyReversed),'historical review retains its rule priority order');
  assert.ok(input['3h'].items[0].tracking.dropIf);
  assert.deepEqual(input['3h'].changes.added,['FRESHUSDT','FADEUSDT']);
  assert.equal(store.claimMarketBriefCheck(now),true);
  store.saveMarketBriefCache(input,'first',now);
  enrich('FRESHUSDT',{},-5*minute);
  const steady=store.getMarketBriefInput(now+5*minute)['3h'];
  assert.equal(steady.items[0].tracking.state,'continuing','fresh unchanged evidence is sustained, not strengthened or downgraded');
  assert.deepEqual(steady.changes.downgraded,[]);
  assert.equal(store.claimMarketBriefCheck(now+9*minute),false);
  store.close(); store=openMarketAlertsStore(path);
  assert.equal(store.claimMarketBriefCheck(now+9*minute),false,'restart preserves cooldown');
  assert.equal(store.claimMarketBriefCheck(now+10*minute),true);
  enrich('FRESHUSDT',{volumeRatio5m:3,pct5m:3},-10*minute);
  enrich('FADEUSDT',{pct5m:-2,pct15m:-4},-10*minute);
  const next=store.getMarketBriefInput(now+10*minute);
  assert.equal(next['3h'].items[0].tracking.state,'strengthening');
  assert.deepEqual(next['3h'].changes.added,[]);
  assert.deepEqual(next['3h'].changes.downgraded,['FADEUSDT']);
  store.saveMarketBriefCache(next,'next',now+10*minute,true);
  assert.equal(store.saveMarketBriefCache(input,'late',now),false,'late AI result cannot overwrite a newer claimed cycle');
  assert.equal(store.readMarketBriefCache(now+10*minute).reports['3h'].stale,false,'AI outage does not stale fresh rule evidence');
  assert.equal(store.readMarketBriefCache(now+40*minute).reports['3h'].stale,true);
  const empty=store.getMarketBriefInput(now+40*minute);
  assert.equal(empty['3h'].items.length,0,'all expired evidence may produce empty list');
  assert.equal(empty['3h'].status,'empty');
  store.close();
  const db=new DatabaseSync(path);
  const legacy={'3h':{...input['3h'],schemaVersion:undefined},'24h':{...input['24h'],schemaVersion:undefined}};
  db.prepare('UPDATE market_alert_brief SET schema_version=1,next_check_ms=?, checked_at=?,reports_json=? WHERE id=1').run(now+180*minute,new Date(now).toISOString(),JSON.stringify(legacy));db.close();
  store=openMarketAlertsStore(path);
  assert.equal(store.readMarketBriefCache(now).reports['3h'],undefined,'legacy counts never presented as tracking');
  assert.equal(store.claimMarketBriefCheck(now+minute),true,'upgrade allows immediate check');
  store.saveMarketBriefCache(input,'migrated',now+minute);
  assert.equal(store.claimMarketBriefCheck(now+2*minute),false,'migration is once even on reopen');
  for (const symbol of ['B1','B2','B3','B4']) {store.insertMarketAlertEvent(event(symbol,symbol,minute));enrich(symbol);}
  assert.equal(store.getMarketBriefInput(now)['3h'].items.length,3,'selection hard maximum');
  enrich('FRESHUSDT',{observedAt:new Date(now+minute).toISOString()});
  enrich('B1',{volumeRatio5m:null});enrich('B2',{},0,{error:'fetch failed'});enrich('B3',{},0,{stale:true});
  assert.deepEqual(store.getMarketBriefInput(now)['3h'].items.map(x=>x.symbol),['B4']);
  enrich('B4',{pct15m:.8});
  const waiting=store.getMarketBriefInput(now);
  store.saveMarketBriefCache(waiting,'waiting',now+minute);
  enrich('B4',{pct15m:1.2},-2*minute);
  const confirmed=store.getMarketBriefInput(now+2*minute);
  assert.equal(confirmed['3h'].items.find(item=>item.symbol==='B4').tracking.state,'strengthening','crossing slower confirmation threshold changes status');
  assert.notEqual(marketBriefReportFingerprint(waiting['3h']),marketBriefReportFingerprint(confirmed['3h']));
  store.close();store=openMarketAlertsStore(join(dir,'directions.sqlite'));
  store.insertMarketAlertEvent(event('short','DOWNUSDT',minute,'SHORT'));
  enrich('DOWNUSDT',{pct5m:-2,pct15m:-4});
  store.insertMarketAlertEvent(event('squeeze','SQUSDT',minute,null,'short_squeeze'));
  enrich('SQUSDT',{pct1m:.2,pct5m:.8,pct15m:100,volumeRatio1m:1.1,volumeRatio5m:50});
  const directions=store.getMarketBriefInput(now)['3h'];
  assert.equal(directions.items.find(x=>x.symbol==='DOWNUSDT').direction,'down');
  assert.deepEqual(directions.items.find(x=>x.symbol==='DOWNUSDT').figures,{fast:-2,slow:-4,vol:2,oi:3},'downside figures retain measured signs');
  assert.deepEqual(directions.items.find(x=>x.symbol==='SQUSDT').figures,{fast:.2,slow:.8,vol:1.1},'squeeze impulse uses the existing one-minute/five-minute values and cannot expose OI');
  const squeeze=directions.items.find(x=>x.symbol==='SQUSDT').tracking;
  assert.equal(squeeze.state,'waiting','squeeze trigger metrics must not masquerade as fresh confirmation');
  assert.match(squeeze.evidence[0],/1m \/ 5m/);
  assert.match(squeeze.evidence[1],/1\.10/);
  assert.doesNotMatch(squeeze.evidence.join(' '),/100\.00|50\.00/);
  store.close();store=openMarketAlertsStore(join(dir,'trend.sqlite'));
  const closed={candleClosedAt:new Date(now-minute).toISOString(),pct5m:-.2,pct15m:.3,pct1h:6.95,volumeRatio5m:.6,distanceFromHighPct:-.7,distanceFromLowPct:8,supportBreak:false,lowerStructure:false,breakout20:false,spotChange15m:.2};
  store.insertMarketAlertEvent(event('sui','SUIUSDT',80*minute));
  enrich('SUIUSDT',{pct5m:-2,pct15m:-3,volumeRatio5m:.1,watchlist:closed});
  const trendInput=store.getMarketBriefInput(now);
  const sui=trendInput['3h'].items.find(item=>item.symbol==='SUIUSDT');
  assert.ok(sui,'hourly strength with intact consolidation stays tracked beyond a single impulse, using complete candles');
  assert.equal(sui.tracking.trend,'strong_up');
  assert.deepEqual(sui.figures,{fast:-.2,slow:.3,vol:.6,hour:6.95,dist:-.7,oi:3},'all live figures come from the same complete-candle context used by tracking evidence');
  assert.equal(sui.tracking.confirmation,'consolidating');
  assert.match(sui.reason,/小时.*强势.*整理/);
  assert.match(sui.tracking.evidence.join(' '),/6\.95%/);
  assert.match(sui.tracking.nextWatch,/1\.5/);
  assert.doesNotMatch(sui.tracking.dropIf,/量比低于 0\.8/,'ordinary contraction alone does not invalidate sustained strength');
  assert.equal(Date.parse(sui.tracking.expiresAt),now+19*minute,'closed candle freshness bounds expiry');
  assert.equal(store.claimMarketBriefCheck(now),true);store.saveMarketBriefCache(trendInput,'trend',now);
  enrich('SUIUSDT',{watchlist:{...closed,pct1h:6.8,distanceFromHighPct:-.8,volumeRatio5m:.65}});
  assert.equal(marketBriefReportFingerprint(trendInput['3h']),marketBriefReportFingerprint(store.getMarketBriefInput(now)['3h']),'numeric drift within the same trend and confirmation facts does not trigger new narration');
  enrich('SUIUSDT',{watchlist:{...closed,candleClosedAt:new Date(now+4*minute).toISOString(),pct5m:-.1,pct1h:6.8}},-5*minute);
  const continuingTrend=store.getMarketBriefInput(now+5*minute)['3h'];
  assert.equal(continuingTrend.items[0].tracking.state,'continuing');
  assert.deepEqual(continuingTrend.changes.downgraded,[],'consolidation is not a trend downgrade');
  enrich('SUIUSDT',{watchlist:{...closed,pct5m:1,pct15m:2,volumeRatio5m:2}});
  const resumedTrend=store.getMarketBriefInput(now)['3h'];
  assert.equal(resumedTrend.items[0].tracking.confirmation,'confirmed');
  assert.notEqual(marketBriefReportFingerprint(trendInput['3h']),marketBriefReportFingerprint(resumedTrend));
  for (const patch of [{pct1h:2.9},{distanceFromHighPct:-1.6},{pct15m:-.6},{pct5m:-.9},{supportBreak:true},{lowerStructure:true},{volumeRatio5m:0},{pct1h:null},{candleClosedAt:new Date(now-21*minute).toISOString()},{candleClosedAt:new Date(now+minute).toISOString()}]) {
    enrich('SUIUSDT',{watchlist:{...closed,...patch}});
    assert.equal(store.getMarketBriefInput(now)['3h'].items.length,0,`invalid trend evidence excluded: ${JSON.stringify(patch)}`);
  }
  enrich('SUIUSDT',{watchlist:{...closed,candleClosedAt:new Date(now+40*minute).toISOString()}},-41*minute);
  assert.equal(store.getMarketBriefInput(now+41*minute)['3h'].items.length,0,'trend alerts cannot remain indefinitely');
  enrich('SUIUSDT',{watchlist:closed});
  store.insertMarketAlertEvent(event('trend-squeeze','SQTRUSDT',minute,null,'short_squeeze'));
  enrich('SQTRUSDT',{pct1m:-2,pct5m:-2,pct15m:100,volumeRatio5m:50,watchlist:closed});
  const sqTrend=store.getMarketBriefInput(now)['3h'].items.find(item=>item.symbol==='SQTRUSDT');
  assert.equal(sqTrend.tracking.trend,'strong_up','complete candles also support squeeze candidates without old trigger values');
  assert.deepEqual(sqTrend.figures,{fast:-.2,slow:.3,vol:.6,hour:6.95,dist:-.7},'squeeze with complete candles uses context instead of squeeze trigger values and still omits OI');
  assert.doesNotMatch(sqTrend.tracking.evidence.join(' '),/100\.00|50\.00/);
  store.insertMarketAlertEvent(event('trend-down','WEAKUSDT',minute,'SHORT'));
  enrich('WEAKUSDT',{watchlist:{...closed,pct1h:-7,pct5m:.2,pct15m:-.3,distanceFromLowPct:.7,distanceFromHighPct:-8,supportBreak:true,lowerStructure:true,breakout20:false}});
  const downTrend=store.getMarketBriefInput(now)['3h'].items.find(item=>item.symbol==='WEAKUSDT');
  assert.equal(downTrend.tracking.trend,'strong_down','weak hourly structure has symmetric tracking');
  assert.deepEqual(downTrend.figures,{fast:.2,slow:-.3,vol:.6,hour:-7,dist:.7,oi:3},'downside distance comes from the low rather than high');
  assert.equal(downTrend.tracking.confirmation,'consolidating');
  enrich('WEAKUSDT',{watchlist:{...closed,pct1h:-7,distanceFromLowPct:.7,breakout20:true}});
  assert.ok(!store.getMarketBriefInput(now)['3h'].items.some(item=>item.symbol==='WEAKUSDT'),'upward breakout invalidates the sustained down route');
  store.close();store=openMarketAlertsStore(join(dir,'optional-figures.sqlite'));
  store.insertMarketAlertEvent(event('optional','OPTIONALUSDT',minute));
  enrich('OPTIONALUSDT',{oiGrowth15m:null,watchlist:{...closed,pct5m:2,pct15m:4,volumeRatio5m:2,pct1h:null,distanceFromHighPct:null,distanceFromLowPct:null}});
  assert.deepEqual(store.getMarketBriefInput(now)['3h'].items[0].figures,{fast:2,slow:4,vol:2},'unavailable optional values must be absent rather than invalid template inputs');
  store.close();store=openMarketAlertsStore(join(dir,'incomplete-structure.sqlite'));
  for (const [symbol,side,price,missingField] of [['NOLOWUSDT','LONG',106,3],['NOHIGHUSDT','SHORT',94,2]]) {
    const candles=Array.from({length:288},(_,index)=>{
      const value=index>=276 ? price : 100;
      const openedAt=now-(288-index)*5*minute;
      const row=[openedAt,value,value*1.001,value*.999,value,10,openedAt+5*minute-1];
      if(index>=276) row[missingField]=null;
      return row;
    });
    const metrics=deriveOpportunityMetrics({seed:{symbol,price,pct24h:0,quoteVolume:1e7,marketCapUsd:null,fdvUsd:null,squeezeMetrics:null,alertCounts:{pump:1,crash:0,squeeze:0,total:1}},futures5m:candles,futures1m:[],spot5m:null,premium:null,openInterest:[],globalLongShortRatio:null,topTraderLongShortRatio:null,takerBuySellRatio:null,observedAt:new Date(now).toISOString()});
    store.insertMarketAlertEvent(event(symbol,symbol,minute,side));
    enrich(symbol,metrics);
    assert.ok(!store.getMarketBriefInput(now)['3h'].items.some(item=>item.symbol===symbol),'missing structure prices cannot establish intact hourly trend');
  }
} finally {try{store.close()}catch{} rmSync(dir,{recursive:true,force:true});}
