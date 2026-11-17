"""Durable order intent journal. No exchange write is ever automatically retried."""
import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_UP
from pathlib import Path


class TradeError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def number(value, name, minimum=0, maximum=1e15):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum < value <= maximum:
        raise TradeError('Invalid ' + name)
    return Decimal(str(value))


def rounded(value, step, up=False):
    value, step = Decimal(str(value)), Decimal(str(step))
    return (value / step).to_integral_value(rounding=ROUND_UP if up else ROUND_DOWN) * step


@dataclass
class Metadata:
    symbol: str
    step: str
    tick: str
    minimum: str
    min_notional: str
    max_leverage: int
    max_qty: str = '1000000000000'


LIMITS = dict(maxOrderNotional=500, maxSymbolNotional=1000, maxTotalNotional=3000,
              maxLeverage=5, maxDailyLoss=200, slippagePct=1)
ACTIVE = ('uncertain', 'open', 'partial')
PROTECTION_WARNING = 'PROTECTION FAILURE/UNCERTAIN: position may be unprotected. Inspect exchange orders immediately; protection is never blindly retried.'


def risk_symbol(symbol):
    # Group explicit native multiplier contracts for exposure only, never for execution sizing.
    if symbol.startswith('1000'):
        symbol = symbol[4:]
    elif symbol.startswith('k') and len(symbol) > 1 and symbol[1].isupper():
        symbol = symbol[1:]
    return symbol.upper()


class Engine:
    def __init__(self, path, adapters, enabled=False, mode='readonly', limits=None, clock=time.time):
        self.clock, self.adapters = clock, adapters
        self.enabled, self.mode = enabled, mode
        if mode not in ('readonly', 'live'):
            raise TradeError('Invalid trading mode')
        self.limits = {**LIMITS, **(limits or {})}
        for key, value in self.limits.items():
            number(value, key)
        if self.limits['maxLeverage'] > 5 or self.limits['slippagePct'] > 1:
            raise TradeError('Leverage/slippage hard ceiling exceeded')
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.guard = threading.RLock()
        self.account_cache = {}
        # An OS lock survives threads and prevents a second service process sharing this journal.
        self.lock_file = open(str(path) + '.lock', 'a+b')
        try:
            if os.name == 'nt':
                import msvcrt
                self.lock_file.seek(0)
                msvcrt.locking(self.lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock_file.close()
            raise TradeError('Trader journal is already in use', 503) from None
        self.db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS intents (
            cid TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, request TEXT NOT NULL,
            plan TEXT NOT NULL, result TEXT NOT NULL, state TEXT NOT NULL, created REAL NOT NULL,
            protected REAL NOT NULL DEFAULT 0, warning TEXT);
          CREATE TABLE IF NOT EXISTS protections (
            cid TEXT PRIMARY KEY, parent TEXT NOT NULL, plan TEXT NOT NULL,
            state TEXT NOT NULL, result TEXT);
          CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY, created REAL, venue TEXT, symbol TEXT, status TEXT, message TEXT);
          CREATE TABLE IF NOT EXISTS daily (
            day TEXT PRIMARY KEY, baseline REAL NOT NULL, loss REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS fills (
            parent TEXT NOT NULL, cumulative REAL NOT NULL, quantity REAL NOT NULL,
            price REAL NOT NULL, fee REAL, created REAL NOT NULL,
            PRIMARY KEY(parent,cumulative));
        ''')

    def close(self):
        self.db.close()
        self.lock_file.close()

    def event(self, venue, symbol, status, message):
        self.db.execute('INSERT INTO events(created,venue,symbol,status,message) VALUES(?,?,?,?,?)',
                        (self.clock(), venue, symbol, status, message))

    def venue(self, value):
        if value not in ('binance', 'hyperliquid'):
            raise TradeError('An explicit current venue is required')
        if value not in self.adapters:
            raise TradeError('Account is not configured', 503)
        return self.adapters[value]

    def writable(self):
        if not self.enabled or self.mode != 'live':
            raise TradeError('Trading is disabled or readonly', 403)

    def day(self):
        local = datetime.fromtimestamp(self.clock(), timezone(timedelta(hours=8)))
        return local.date().isoformat(), local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()

    def snapshots(self, strict=True, fresh=True):
        states = {}
        for venue, adapter in self.adapters.items():
            cached = self.account_cache.get(venue)
            if not fresh and cached and cached[2] == self.day()[0] and 0 <= self.clock() - cached[0] < 10:
                states[venue] = {**cached[1], '_updated': cached[0]}
                continue
            try:
                state = adapter.snapshot(self.day()[1])
                for key in ('equity', 'availableBalance', 'realized'):
                    if not math.isfinite(float(state[key])):
                        raise ValueError()
                self.account_cache[venue] = (self.clock(), state, self.day()[0])
                states[venue] = {**state, '_updated': self.clock()}
            except Exception:
                if strict:
                    raise TradeError('Account synchronization unavailable; opening blocked', 503) from None
                if cached:
                    states[venue] = {**cached[1], '_updated': cached[0], '_stale': True}
        return states

    def daily_loss(self, states):
        day, _ = self.day()
        equity = sum(float(s['equity']) for s in states.values())
        # Positive unrealized PnL never offsets realized losses. Fees/funding are in realized.
        conservative = sum(max(0, -float(s['realized'])) +
                           sum(max(0, -float(p['unrealizedPnl'])) for p in s['positions'])
                           for s in states.values())
        self.db.execute('INSERT OR IGNORE INTO daily VALUES(?,?,0)', (day, equity))
        row = self.db.execute('SELECT * FROM daily WHERE day=?', (day,)).fetchone()
        loss = max(row['loss'], conservative, row['baseline'] - equity, 0)
        self.db.execute('UPDATE daily SET loss=? WHERE day=?', (loss, day))
        return loss

    def validate(self, req):
        allowed = {'clientOrderId', 'venue', 'symbol', 'side', 'type', 'notional', 'leverage',
                   'limitPrice', 'stopLossPct', 'takeProfitPct', 'reduceOnly', 'closeFraction', 'newsId'}
        if not isinstance(req, dict) or set(req) - allowed:
            raise TradeError('Invalid order fields')
        if not isinstance(req.get('clientOrderId'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,64}', req['clientOrderId']):
            raise TradeError('Invalid clientOrderId (8-64 letters, digits, dash, underscore)')
        if not isinstance(req.get('symbol'), str) or not re.fullmatch(r'[A-Za-z0-9]{1,24}', req['symbol']):
            raise TradeError('Invalid symbol')
        self.venue(req.get('venue'))
        if req.get('side') not in ('buy', 'sell') or req.get('type') not in ('market', 'limit'):
            raise TradeError('Invalid side or type')
        if type(req.get('reduceOnly', False)) is not bool:
            raise TradeError('Invalid reduceOnly')
        number(req.get('leverage'), 'leverage', maximum=self.limits['maxLeverage'])
        if req['leverage'] != int(req['leverage']):
            raise TradeError('Leverage must be an integer')
        number(req.get('notional'), 'notional')
        if req['type'] == 'limit':
            number(req.get('limitPrice'), 'limitPrice')
        elif 'limitPrice' in req:
            raise TradeError('Market order must not specify limitPrice')
        if req.get('reduceOnly'):
            number(req.get('closeFraction', 1), 'closeFraction', maximum=1)
            if 'stopLossPct' in req or 'takeProfitPct' in req:
                raise TradeError('A close cannot create protection orders')
        elif 'closeFraction' in req:
            raise TradeError('closeFraction requires reduceOnly')
        for key in ('stopLossPct', 'takeProfitPct'):
            if key in req:
                number(req[key], key, maximum=99)
        if 'newsId' in req and (not isinstance(req['newsId'], str) or len(req['newsId']) > 160):
            raise TradeError('Invalid newsId')

    def rows(self):
        return self.db.execute("SELECT * FROM intents WHERE state IN ('uncertain','open','partial')").fetchall()

    def risk(self, req, states, notional):
        if self.db.execute('SELECT 1 FROM intents WHERE warning IS NOT NULL LIMIT 1').fetchone():
            raise TradeError('Unresolved protection failure; inspect/reconcile before opening', 409)
        if self.daily_loss(states) >= self.limits['maxDailyLoss']:
            raise TradeError('Daily loss limit reached; reduce-only operations only', 409)
        if notional > Decimal(str(self.limits['maxOrderNotional'])):
            raise TradeError('Order notional limit exceeded', 409)
        total, symbol_total = Decimal(0), Decimal(0)
        seen = set()
        for state in states.values():
            for p in state['positions']:
                n = Decimal(str(abs(p['notional'])))
                total += n
                if risk_symbol(p['symbol']) == risk_symbol(req['symbol']):
                    symbol_total += n
            for o in state['orders']:
                if o.get('reduceOnly', False):
                    continue
                n = Decimal(str(o['size'])) * max(Decimal(str(o.get('price') or 0)), Decimal(str(o.get('markPrice') or 0)))
                if n <= 0:
                    raise TradeError('Cannot value pending order; opening blocked', 409)
                total += n
                if risk_symbol(o['symbol']) == risk_symbol(req['symbol']):
                    symbol_total += n
                seen.add(o.get('clientOrderId'))
        for row in self.rows():
            plan = json.loads(row['plan'])
            if row['state'] == 'uncertain':
                raise TradeError('Uncertain execution exists; reconcile before opening', 409)
            if plan['reduceOnly'] or plan['cid'] in seen:
                continue
            n = Decimal(plan['qty']) * Decimal(plan['price'])
            total += n
            if risk_symbol(plan['symbol']) == risk_symbol(req['symbol']):
                symbol_total += n
        if symbol_total + notional > self.limits['maxSymbolNotional']:
            raise TradeError('Symbol exposure limit exceeded (positions and pending orders)', 409)
        if total + notional > self.limits['maxTotalNotional']:
            raise TradeError('Total exposure limit exceeded (both accounts)', 409)
        now = self.clock()
        recent = self.db.execute('SELECT request FROM intents WHERE created>?', (now - 60,)).fetchall()
        if len(recent) >= 10:
            raise TradeError('Order rate limit reached', 429)
        duplicate = self.db.execute('SELECT request FROM intents WHERE created>?', (now - 10,)).fetchall()
        if any(risk_symbol((r := json.loads(row['request']))['symbol']) == risk_symbol(req['symbol']) and r['side'] == req['side'] for row in duplicate):
            raise TradeError('Duplicate direction within 10 seconds', 429)

    def place(self, req):
        with self.guard:
            self.writable()
            self.validate(req)
            fingerprint = hashlib.sha256(json.dumps(req, sort_keys=True, allow_nan=False).encode()).hexdigest()
            row = self.db.execute('SELECT * FROM intents WHERE cid=?', (req['clientOrderId'],)).fetchone()
            if row:
                if row['fingerprint'] != fingerprint:
                    raise TradeError('clientOrderId already belongs to another request', 409)
                self.sync()
                self.reconcile(row)
                return json.loads(self.db.execute('SELECT result FROM intents WHERE cid=?', (row['cid'],)).fetchone()[0])
            self.sync()
            adapter = self.venue(req['venue'])
            meta = adapter.metadata(req['symbol'])
            req = {**req, 'symbol': meta.symbol}
            reduce = req.get('reduceOnly', False)
            # Reductions remain available if the other venue is disconnected.
            states = ({req['venue']: adapter.snapshot(self.day()[1], include_pnl=False)} if reduce else self.snapshots())
            state = states[req['venue']]
            positions = [p for p in state['positions'] if p['symbol'] == meta.symbol and p['size'] > 0]
            if len(positions) > 1:
                raise TradeError('Ambiguous position mode; one-way positions required', 409)
            p = positions[0] if positions else None
            if not reduce and p and (p['side'] == 'long') != (req['side'] == 'buy'):
                raise TradeError('Opposite position exists; explicitly reduce/close first', 409)
            if not reduce:
                for order in state['orders']:
                    if order['symbol'] != meta.symbol:
                        continue
                    if order.get('reduceOnly') and not p:
                        raise TradeError('Cancel stale reduce-only protection before reopening symbol', 409)
                    if not order.get('reduceOnly') and order['side'].lower() != req['side']:
                        raise TradeError('Opposite pending order exists; explicitly cancel first', 409)
            if reduce:
                if not p or (p['side'] == 'long') == (req['side'] == 'buy'):
                    raise TradeError('Close direction does not reduce the current position', 409)
                for existing in self.rows():
                    plan = json.loads(existing['plan'])
                    if plan['venue'] == req['venue'] and plan['symbol'] == meta.symbol:
                        raise TradeError('Pending execution for symbol; cancel/reconcile before closing', 409)
                if any(o['symbol'] == meta.symbol and not o.get('reduceOnly') for o in state['orders']):
                    raise TradeError('Cancel opening orders before closing this symbol', 409)
            mark = number(float(adapter.price(meta.symbol)), 'mark price')
            buy = req['side'] == 'buy'
            slip = Decimal(str(self.limits['slippagePct'])) / 100
            price = rounded(mark * (1 + slip if buy else 1 - slip), meta.tick, up=not buy) if req['type'] == 'market' else rounded(req['limitPrice'], meta.tick, up=not buy)
            qty = rounded(Decimal(str(p['size'])) * Decimal(str(req.get('closeFraction', 1))) if reduce
                          else Decimal(str(req['notional'])) / max(mark, price), meta.step)
            if qty < Decimal(meta.minimum) or qty > Decimal(meta.max_qty) or (not reduce and qty * min(mark, price) < Decimal(meta.min_notional)):
                raise TradeError('Quantity/notional outside exchange filters')
            if price <= 0 or (not reduce and req['leverage'] > meta.max_leverage):
                raise TradeError('Invalid price or leverage exceeds market maximum')
            if not reduce:
                if req['notional'] > self.limits['maxOrderNotional']:
                    raise TradeError('Order notional limit exceeded', 409)
                self.risk(req, states, qty * max(mark, price))
                adapter.prepare(meta.symbol, req['leverage'])
            cid = 'sh' + hashlib.sha256(req['clientOrderId'].encode()).hexdigest()[:30]
            plan = dict(cid=cid, venue=req['venue'], symbol=meta.symbol, side=req['side'],
                        qty=str(qty), price=str(price), tif='IOC' if req['type'] == 'market' else 'GTC', reduceOnly=reduce)
            result = dict(clientOrderId=req['clientOrderId'], status='uncertain', warning='Execution uncertain; query with the SAME clientOrderId. Do not submit a new ID.')
            if 'stopLossPct' in req or 'takeProfitPct' in req:
                result['warning'] += ' PROTECTION PENDING: stops wait for a confirmed actual fill.'
                result['protectionStatus'] = 'pending-confirmation'
            self.db.execute('INSERT INTO intents(cid,fingerprint,request,plan,result,state,created) VALUES(?,?,?,?,?,?,?)',
                            (req['clientOrderId'], fingerprint, json.dumps(req), json.dumps(plan), json.dumps(result), 'uncertain', self.clock()))
            self.event(req['venue'], meta.symbol, 'submitting', 'Manual order intent durably recorded')
            self.account_cache.pop(req['venue'], None)
            try:
                response = adapter.submit(plan)
            except Exception:
                self.event(req['venue'], meta.symbol, 'uncertain', 'Exchange acknowledgement unavailable; no automatic resubmission')
                return result
            return self.record(req['clientOrderId'], response)

    def record(self, cid, response):
        row = self.db.execute('SELECT * FROM intents WHERE cid=?', (cid,)).fetchone()
        req = json.loads(row['request'])
        result = {'clientOrderId': cid, **response}
        for key in ('warning', 'protectionError', 'protectionStatus'):
            result.pop(key, None)
        if response.get('warning') and not str(response['warning']).startswith('PROTECTION'):
            result['warning'] = response['warning']
        filled, price = float(response.get('filled', 0)), float(response.get('price', 0))
        if not math.isfinite(filled) or not math.isfinite(price) or filled < 0 or (filled > 0 and price <= 0):
            self.db.execute("UPDATE intents SET state='uncertain' WHERE cid=?", (cid,))
            return json.loads(row['result'])
        previous = self.db.execute('SELECT COALESCE(MAX(cumulative),0) FROM fills WHERE parent=?', (cid,)).fetchone()[0]
        if filled > previous:
            previous_value = self.db.execute('SELECT COALESCE(SUM(quantity*price),0) FROM fills WHERE parent=?', (cid,)).fetchone()[0]
            delta_price = max(0, (filled * price - previous_value) / (filled - previous))
            self.db.execute('INSERT OR IGNORE INTO fills VALUES(?,?,?,?,?,?)', (cid, filled, filled - previous, delta_price, response.get('fee'), self.clock()))
        self.db.execute('UPDATE intents SET state=?,result=? WHERE cid=?', (response['status'], json.dumps(result), cid))
        if row['state'] != response['status'] or filled > previous:
            self.account_cache.pop(req['venue'], None)
            self.event(req['venue'], req['symbol'], response['status'],
                       f"Order {response.get('id', '')}; confirmed fill {filled} @ {price}; fee {response.get('fee', 'see exchange fills')}")
        if not req.get('reduceOnly') and response.get('filled', 0) > row['protected'] and self.enabled and self.mode == 'live':
            try:
                self.protect(row, req, response)
            except Exception:
                # A confirmed fill must never be hidden behind an HTTP failure during protection setup.
                self.db.execute('UPDATE intents SET protected=?,warning=? WHERE cid=?', (response['filled'], PROTECTION_WARNING, cid))
                self.event(req['venue'], req['symbol'], 'protection_failed', PROTECTION_WARNING)
        elif response.get('filled', 0) > row['protected'] and ('stopLossPct' in req or 'takeProfitPct' in req):
            warning = 'PROTECTION PENDING: service readonly/disabled; confirmed fill has no newly submitted protection. Inspect exchange immediately.'
            self.db.execute('UPDATE intents SET warning=? WHERE cid=?', (warning, cid))
            self.event(req['venue'], req['symbol'], 'protection_pending', warning)
        warning = self.db.execute('SELECT warning FROM intents WHERE cid=?', (cid,)).fetchone()[0]
        if warning:
            result.update(warning=warning, protectionError=warning)
            result['protectionStatus'] = 'uncertain'
        elif 'stopLossPct' in req or 'takeProfitPct' in req:
            if response['status'] in ACTIVE:
                result.update(warning='PROTECTION PENDING: only confirmed filled quantities are protected; remaining limit quantity is not yet protected.', protectionStatus='pending-fill')
            else:
                result['protectionStatus'] = 'active' if response.get('filled', 0) else 'not-filled'
        self.db.execute('UPDATE intents SET result=? WHERE cid=?', (json.dumps(result), cid))
        return result

    def protect(self, row, req, response):
        adapter = self.venue(req['venue'])
        meta = adapter.metadata(req['symbol'])
        qty = rounded(Decimal(str(response['filled'])) - Decimal(str(row['protected'])), meta.step)
        if qty <= 0:
            return
        warning = None
        for key, kind in (('stopLossPct', 'sl'), ('takeProfitPct', 'tp')):
            if key not in req:
                continue
            cid = 'sh' + hashlib.sha256(f"{row['cid']}:{kind}:{response['filled']}".encode()).hexdigest()[:30]
            pct = Decimal(str(req[key])) / 100
            long = req['side'] == 'buy'
            above = (kind == 'tp') == long
            trigger = rounded(Decimal(str(response['price'])) * (1 + pct if above else 1 - pct), meta.tick, up=above)
            plan = dict(cid=cid, venue=req['venue'], symbol=meta.symbol, side='sell' if long else 'buy',
                        qty=str(qty), price=str(trigger), trigger=kind, reduceOnly=True, tif='GTC')
            existing = self.db.execute('SELECT state FROM protections WHERE cid=?', (cid,)).fetchone()
            if existing:
                if existing['state'] in ('uncertain', 'rejected'):
                    warning = PROTECTION_WARNING
                continue
            self.db.execute('INSERT INTO protections VALUES(?,?,?,?,NULL)', (cid, row['cid'], json.dumps(plan), 'uncertain'))
            try:
                result = adapter.submit(plan)
                self.db.execute('UPDATE protections SET state=?,result=? WHERE cid=?', (result['status'], json.dumps(result), cid))
                if result['status'] not in ('open', 'partial', 'filled'):
                    raise TradeError('Protection not confirmed')
                self.event(req['venue'], meta.symbol, 'protected', f"Reduce-only {kind}; quantity {qty}; trigger {trigger}; order {result.get('id', '')}")
            except Exception:
                warning = PROTECTION_WARNING
                self.event(req['venue'], meta.symbol, 'protection_failed', warning)
        self.db.execute("UPDATE intents SET protected=?,warning=CASE WHEN warning LIKE 'PROTECTION PENDING:%' THEN ? ELSE COALESCE(?,warning) END WHERE cid=?",
                        (float(response['filled']), warning, warning, row['cid']))

    def reconcile(self, row):
        if row['state'] not in ACTIVE:
            return
        plan = json.loads(row['plan'])
        try:
            response = self.venue(plan['venue']).query(plan['symbol'], plan['cid'])
            if response:
                self.record(row['cid'], response)
        except Exception:
            pass

    def sync(self):
        with self.guard:
            # Recover a crash between a durable fill acknowledgement and protection intent creation.
            recover = self.db.execute("SELECT * FROM intents WHERE state IN ('filled','canceled')").fetchall()
            if self.enabled and self.mode == 'live':
                for row in recover:
                    result, req = json.loads(row['result']), json.loads(row['request'])
                    if req.get('reduceOnly') or result.get('filled', 0) <= row['protected']:
                        continue
                    if not ('stopLossPct' in req or 'takeProfitPct' in req):
                        self.db.execute('UPDATE intents SET protected=? WHERE cid=?', (result['filled'], row['cid']))
                        continue
                    try:
                        current = self.venue(req['venue']).snapshot(self.day()[1], include_pnl=False)
                        positions = [p for p in current['positions'] if p['symbol'] == req['symbol'] and (p['side'] == 'long') == (req['side'] == 'buy')]
                        if not positions or positions[0]['size'] < result['filled'] - row['protected']:
                            self.db.execute('UPDATE intents SET protected=?,warning=? WHERE cid=?', (result['filled'], PROTECTION_WARNING, row['cid']))
                            self.event(req['venue'], req['symbol'], 'protection_failed', 'PROTECTION RECOVERY: current position changed; inspect manually')
                        self.record(row['cid'], result)
                    except Exception:
                        self.db.execute('UPDATE intents SET warning=? WHERE cid=?', (PROTECTION_WARNING, row['cid']))
            for row in self.rows():
                self.reconcile(row)
            for row in self.db.execute("SELECT * FROM protections WHERE state='uncertain'").fetchall():
                plan = json.loads(row['plan'])
                try:
                    result = self.venue(plan['venue']).query(plan['symbol'], row['cid'], trigger=True)
                    if result:
                        self.db.execute('UPDATE protections SET state=?,result=? WHERE cid=?', (result['status'], json.dumps(result), row['cid']))
                        parent = self.db.execute('SELECT * FROM intents WHERE cid=?', (row['parent'],)).fetchone()
                        req = json.loads(parent['request'])
                        legs = self.db.execute('SELECT state FROM protections WHERE parent=?', (row['parent'],)).fetchall()
                        expected = sum(key in req for key in ('stopLossPct', 'takeProfitPct'))
                        if len(legs) >= expected and all(leg['state'] in ('open', 'partial', 'filled') for leg in legs):
                            self.db.execute('UPDATE intents SET warning=NULL WHERE cid=?', (row['parent'],))
                            self.record(parent['cid'], json.loads(parent['result']))
                            self.event(req['venue'], req['symbol'], 'protection_confirmed', 'Previously uncertain protection now confirmed by exchange query; not resubmitted')
                except Exception:
                    pass

    def status(self):
        with self.guard:
            self.sync()
            states = self.snapshots(strict=False, fresh=False)
            if states and len(states) == len(self.adapters) and not any(s.get('_stale') for s in states.values()):
                self.daily_loss(states)
            accounts = []
            for venue in ('binance', 'hyperliquid'):
                state = states.get(venue)
                connected = bool(state) and not state.get('_stale')
                accounts.append(dict(venue=venue, configured=venue in self.adapters, connected=connected,
                                     availableBalance=state['availableBalance'] if state else None,
                                     equity=state['equity'] if state else None,
                                     positions=state['positions'] if state else [], orders=state['orders'] if state else [],
                                     error=None if connected else 'Account unavailable or not configured; displayed data may be stale',
                                     updatedAt=int(state['_updated'] * 1000) if state else None))
            logs = [dict(id=str(r['id']), createdAt=int(r['created'] * 1000), venue=r['venue'], symbol=r['symbol'],
                         status=r['status'], message=r['message']) for r in self.db.execute('SELECT * FROM events ORDER BY id DESC LIMIT 100')]
            warnings = self.db.execute('SELECT warning FROM intents WHERE warning IS NOT NULL ORDER BY created DESC LIMIT 1').fetchone()
            error = warnings[0] if warnings else ('Execution uncertain; reconciliation required' if any(r['state'] == 'uncertain' for r in self.rows()) else None)
            fills = []
            for row in self.db.execute('SELECT f.*,i.request FROM fills f JOIN intents i ON f.parent=i.cid ORDER BY f.created DESC,f.rowid DESC LIMIT 100'):
                req = json.loads(row['request'])
                fills.append(dict(id=row['parent'] + ':' + str(row['cumulative']), venue=req['venue'], symbol=req['symbol'],
                                  side=req['side'], price=row['price'], size=row['quantity'],
                                  createdAt=int(row['created'] * 1000), fee=row['fee']))
            return dict(enabled=self.enabled, mode=self.mode, accounts=accounts, limits=self.limits, logs=logs, fills=fills, error=error)

    def cancel(self, req):
        with self.guard:
            self.writable()
            if not isinstance(req, dict) or set(req) != {'venue', 'symbol', 'orderId'}:
                raise TradeError('Invalid cancellation')
            adapter = self.venue(req['venue'])
            meta = adapter.metadata(req['symbol'])
            oid = req['orderId']
            if not isinstance(oid, str) or not re.fullmatch(r'(?:algo:)?[0-9]{1,30}', oid):
                raise TradeError('Invalid orderId')
            try:
                self.account_cache.pop(req['venue'], None)
                result = adapter.cancel(meta.symbol, oid)
                self.event(req['venue'], meta.symbol, 'cancel_requested', f'Cancellation acknowledged for order {oid}; verify final exchange state')
                self.sync()
                return result
            except Exception:
                self.event(req['venue'], meta.symbol, 'cancel_uncertain', f'Cancellation uncertain for order {oid}; query before retry')
                return dict(status='uncertain', warning='Cancellation uncertain; refresh orders before retrying')

    def close_all(self, req):
        with self.guard:
            self.writable()
            if not isinstance(req, dict) or set(req) != {'venue'}:
                raise TradeError('An explicit current venue is required')
            venue = req['venue']
            adapter = self.venue(venue)
            items = []
            try:
                state = adapter.snapshot(self.day()[1], include_pnl=False)
            except Exception:
                raise TradeError('Cannot read positions for close-all', 503) from None
            for order in state['orders']:
                try:
                    result = self.cancel(dict(venue=venue, symbol=order['symbol'], orderId=order['id']))
                    items.append(dict(action='cancel', symbol=order['symbol'], **result))
                except Exception:
                    items.append(dict(action='cancel', symbol=order['symbol'], status='failed'))
            try:
                state = adapter.snapshot(self.day()[1], include_pnl=False)
            except Exception:
                return dict(ok=False, items=items, warning='Cannot verify cancellations/positions; no closes submitted')
            if state['orders']:
                return dict(ok=False, items=items, warning='Orders remain after cancellation; inspect exchange before closing')
            self.sync()
            for p in state['positions']:
                try:
                    result = self.place(dict(clientOrderId='close-' + uuid.uuid4().hex, venue=venue, symbol=p['symbol'],
                                             side='sell' if p['side'] == 'long' else 'buy', type='market', notional=1,
                                             leverage=1, reduceOnly=True, closeFraction=1))
                    items.append(dict(action='close', symbol=p['symbol'], **result))
                except Exception:
                    items.append(dict(action='close', symbol=p['symbol'], status='failed'))
            try:
                final = adapter.snapshot(self.day()[1], include_pnl=False)
                pending = any(json.loads(row['plan'])['venue'] == venue for row in self.rows())
                ok = not final['positions'] and not final['orders'] and not pending and not any(i.get('status') in ('uncertain', 'failed') for i in items)
            except Exception:
                ok = False
            warning = None if ok else 'Close-all incomplete/uncertain. Inspect remaining positions and orders before retrying; no automatic retries.'
            self.event(venue, '', 'closed_all' if ok else 'close_all_partial', warning or 'Current venue verified flat')
            return dict(ok=ok, venue=venue, items=items, warning=warning)
