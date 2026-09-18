import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const {openMarketAlertsStore}=await import('./market-alerts-store.ts');
const dir=mkdtempSync(join(tmpdir(),'market-brief-'));
const store=openMarketAlertsStore(join(dir,'alerts.sqlite'));
const now=Date.parse('2026-09-18T02:00:00Z');
function event(id,symbol,ago,side='LONG',type='volatility') {
  return {id,symbol,type,side,level:1,stage:'test',trigger:'test',source:'ws',price:1,changePct:5,volumeRatio:3,score:null,metrics:{},reasons:[],occurredAt:new Date(now-ago).toISOString()};
}
try {
  assert.equal(typeof store.getMarketBriefInput,'function','full-window aggregation is available');
  for(let i=0;i<250;i++) store.insertMarketAlertEvent(event(`a${i}`,'AAAUSDT',1000+i));
  store.insertMarketAlertEvent(event('b','BBBUSDT',2000,'SHORT'));
  store.insertMarketAlertEvent(event('rev','AAAUSDT',500,'SHORT'));
  store.insertMarketAlertEvent(event('old','OLDUSDT',2*3600000));
  store.insertMarketAlertEvent(event('s','SQUSDT',3000,null,'short_squeeze'));
  store.insertMarketAlertEvent(event('future','FUTUREUSDT',-1000));
  store.insertMarketAlertEvent(event('expired','EXPIREDUSDT',25*3600000));
  store.insertMarketAlertEvent(event('inside','INSIDEUSDT',3*3600000-1));
  store.insertMarketAlertEvent(event('boundary','BOUNDARYUSDT',3*3600000));
  store.insertMarketAlertEvent(event('outside','OUTSIDEUSDT',3*3600000+1));
  const input=store.getMarketBriefInput(now);
  assert.deepEqual(Object.keys(input),['3h','24h']);
  assert.equal(input['3h'].totals.total,255,'includes the intervening two hours and excludes the three-hour start boundary');
  assert.equal(input['24h'].totals.total,257);
  assert.equal(input['3h'].windowStart,new Date(now-3*3600000).toISOString());
  assert.ok(input['3h'].items.some(item=>item.symbol==='OLDUSDT'),'two-hour-old alerts belong in the short summary');
  assert.equal(input['3h'].items[0].total,251);
  assert.equal(input['3h'].items[0].direction,'down');
  assert.match(input['3h'].risks.join(' '),/AAAUSDT/);
  assert.equal(input['3h'].totals.squeeze,1);
  assert.equal(store.claimMarketBriefCheck(now),true);
  assert.equal(store.claimMarketBriefCheck(now+3*3600000-1),false,'three-hour cooldown');
  store.close();
  const reopened=openMarketAlertsStore(join(dir,'alerts.sqlite'));
  assert.equal(reopened.claimMarketBriefCheck(now+2*3600000),false,'restart must not bypass three-hour quota');
  assert.equal(reopened.readMarketBriefCache(now).nextCheckAt,now+3*3600000);
  assert.equal(reopened.claimMarketBriefCheck(now+3*3600000),true);
  reopened.close();
  const legacyDb=new DatabaseSync(join(dir,'alerts.sqlite'));
  const oldReports={'1h':{...input['3h'],scope:'1h',windowStart:new Date(now-3600000).toISOString(),headline:'old hourly cache'},'24h':input['24h']};
  legacyDb.prepare('UPDATE market_alert_brief SET next_check_ms=?, checked_at=?, reports_json=? WHERE id=1')
    .run(now+3600000,new Date(now).toISOString(),JSON.stringify(oldReports));
  legacyDb.close();
  const migrated=openMarketAlertsStore(join(dir,'alerts.sqlite'));
  try {
    assert.equal(migrated.readMarketBriefCache(now).nextCheckAt,now+3*3600000,'legacy hourly deadline is extended from the last check');
    assert.deepEqual(Object.keys(migrated.readMarketBriefCache(now).reports),['24h'],'preserve the daily cache without relabeling the hourly cache');
    assert.equal(migrated.claimMarketBriefCheck(now+3*3600000-1),false,'legacy state cannot bypass the new interval');
    assert.equal(migrated.claimMarketBriefCheck(now+3*3600000),true);
    const refreshed=migrated.getMarketBriefInput(now+3*3600000);
    migrated.saveMarketBriefCache(refreshed,'new',now+3*3600000);
    assert.deepEqual(Object.keys(migrated.readMarketBriefCache(now+3*3600000).reports),['3h','24h']);
  } finally {migrated.close();}
} finally {try{store.close()}catch{} rmSync(dir,{recursive:true,force:true});}
