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
  const input=store.getMarketBriefInput(now);
  assert.equal(input['1h'].totals.total,253);
  assert.equal(input['24h'].totals.total,254);
  assert.equal(input['1h'].items[0].total,251);
  assert.equal(input['1h'].items[0].direction,'down');
  assert.match(input['1h'].risks.join(' '),/AAAUSDT/);
  assert.equal(input['1h'].totals.squeeze,1);
  assert.equal(store.claimMarketBriefCheck(now),true);
  assert.equal(store.claimMarketBriefCheck(now+3*3600000-1),false,'three-hour cooldown');
  store.close();
  const reopened=openMarketAlertsStore(join(dir,'alerts.sqlite'));
  assert.equal(reopened.claimMarketBriefCheck(now+2*3600000),false,'restart must not bypass three-hour quota');
  assert.equal(reopened.readMarketBriefCache(now).nextCheckAt,now+3*3600000);
  assert.equal(reopened.claimMarketBriefCheck(now+3*3600000),true);
  reopened.close();
  const legacyDb=new DatabaseSync(join(dir,'alerts.sqlite'));
  legacyDb.prepare('UPDATE market_alert_brief SET next_check_ms=?, checked_at=? WHERE id=1')
    .run(now+3600000,new Date(now).toISOString());
  legacyDb.close();
  const migrated=openMarketAlertsStore(join(dir,'alerts.sqlite'));
  try {
    assert.equal(migrated.readMarketBriefCache(now).nextCheckAt,now+3*3600000,'legacy hourly deadline is extended from the last check');
    assert.equal(migrated.claimMarketBriefCheck(now+3*3600000-1),false,'legacy state cannot bypass the new interval');
    assert.equal(migrated.claimMarketBriefCheck(now+3*3600000),true);
  } finally {migrated.close();}
} finally {try{store.close()}catch{} rmSync(dir,{recursive:true,force:true});}
