"""Exchange boundaries. Transport/SDK exceptions never leave this module verbatim."""
import hashlib
import hmac
import json
import logging
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal

from .core import Metadata, TradeError, rounded


def truth(value):
    return value is True or value == 'true'


class ExchangeFailure(TradeError):
    def __init__(self, code=None):
        messages = {-2019: 'Insufficient exchange margin', -1111: 'Exchange precision rejected',
                    -2015: 'Exchange key/IP permissions rejected', -2021: 'Trigger would execute immediately',
                    -4164: 'Exchange minimum notional rejected'}
        super().__init__(messages.get(code, 'Exchange request unavailable or rejected'), 502)
        self.code = code


def http_json(url, data=None, headers=None, method=None):
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=8) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        code = None
        try:
            body = json.loads(exc.read(32768))
            code = body.get('code')
        except Exception:
            pass
        raise ExchangeFailure(code) from None
    except Exception:
        raise ExchangeFailure() from None


def normalized_binance(row, algo=False):
    status = row.get('algoStatus') if algo else row.get('status')
    state = {'NEW': 'open', 'PARTIALLY_FILLED': 'partial', 'FILLED': 'filled', 'CANCELED': 'canceled',
             'CANCELLED': 'canceled', 'EXPIRED': 'canceled', 'REJECTED': 'rejected',
             'FINISHED': 'filled', 'TRIGGERED': 'open'}.get(status, 'uncertain')
    qty = float(row.get('executedQty') or row.get('actualQty') or 0)
    price = float(row.get('avgPrice') or row.get('actualPrice') or 0)
    if qty and not price:
        price = float(row.get('cumQuote') or 0) / qty
    return dict(id=('algo:' + str(row['algoId'])) if algo else str(row['orderId']), status=state,
                filled=qty, price=price)


class Binance:
    def __init__(self, key, secret, testnet=False):
        self.key, self.secret = key, secret
        self.base = 'https://demo-fapi.binance.com' if testnet else 'https://fapi.binance.com'
        self.offset = 0
        self.synced_at = 0
        self.metadata_at = 0
        self.markets = {}

    def public(self, path, params=None):
        query = urllib.parse.urlencode(params or {})
        return http_json(self.base + path + ('?' + query if query else ''))

    def call(self, method, path, params=None):
        if time.monotonic() - self.synced_at > 60:
            start = time.time() * 1000
            remote = self.public('/fapi/v1/time')['serverTime']
            self.offset = remote - (start + time.time() * 1000) / 2
            self.synced_at = time.monotonic()
        params = {**(params or {}), 'timestamp': int(time.time() * 1000 + self.offset), 'recvWindow': 5000}
        query = urllib.parse.urlencode(params)
        query += '&signature=' + hmac.new(self.secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        return http_json(self.base + path + '?' + query, headers={'X-MBX-APIKEY': self.key}, method=method)

    def metadata(self, symbol):
        if not isinstance(symbol, str):
            raise TradeError('Invalid symbol')
        if time.monotonic() - self.metadata_at > 300 or not self.markets:
            info = self.public('/fapi/v1/exchangeInfo')
            self.markets = {row['symbol']: row for row in info['symbols']
                            if row['contractType'] == 'PERPETUAL' and row['status'] == 'TRADING'
                            and row['quoteAsset'] == 'USDT' and row['marginAsset'] == 'USDT'}
            self.metadata_at = time.monotonic()
        pair = symbol.upper()
        if not pair.endswith('USDT'):
            pair += 'USDT'
        if pair not in self.markets:
            raise TradeError('No supported Binance USDT perpetual for symbol')
        row = self.markets[pair]
        filters = {f['filterType']: f for f in row['filters']}
        lot, tick = filters['LOT_SIZE'], filters['PRICE_FILTER']
        return Metadata(pair[:-4], lot['stepSize'], tick['tickSize'], lot['minQty'],
                        filters['MIN_NOTIONAL']['notional'], 5, lot['maxQty'])

    def price(self, symbol):
        return float(self.public('/fapi/v1/premiumIndex', {'symbol': symbol + 'USDT'})['markPrice'])

    def prepare(self, symbol, leverage):
        if truth(self.call('GET', '/fapi/v1/positionSide/dual')['dualSidePosition']):
            raise TradeError('Binance hedge mode is unsupported; configure one-way mode', 409)
        pair = symbol + 'USDT'
        brackets = self.call('GET', '/fapi/v1/leverageBracket', {'symbol': pair})
        if not brackets or leverage > max(int(b['initialLeverage']) for b in brackets[0]['brackets']):
            raise TradeError('Leverage exceeds exchange market maximum', 409)
        risks = self.call('GET', '/fapi/v2/positionRisk', {'symbol': pair})
        if any(float(p['positionAmt']) != 0 and p['marginType'] != 'isolated' for p in risks):
            raise TradeError('Existing cross-margin position; close explicitly before opening', 409)
        try:
            self.call('POST', '/fapi/v1/marginType', {'symbol': pair, 'marginType': 'ISOLATED'})
        except ExchangeFailure as exc:
            if exc.code != -4046:  # Already in requested margin mode.
                raise
        result = self.call('POST', '/fapi/v1/leverage', {'symbol': pair, 'leverage': leverage})
        verify = self.call('GET', '/fapi/v2/positionRisk', {'symbol': pair})
        if int(result['leverage']) != leverage or not verify or any(p['marginType'] != 'isolated' or p['positionSide'] != 'BOTH' or int(p['leverage']) != leverage for p in verify):
            raise TradeError('Cannot confirm isolated one-way leverage', 409)

    def snapshot(self, since, *, include_pnl=True):
        account = self.call('GET', '/fapi/v3/account')
        if truth(self.call('GET', '/fapi/v1/positionSide/dual')['dualSidePosition']):
            raise TradeError('One-way mode required')
        if truth(self.call('GET', '/fapi/v1/multiAssetsMargin')['multiAssetsMargin']):
            raise TradeError('Single-asset USDT margin mode required')
        risks = self.call('GET', '/fapi/v2/positionRisk')
        marks = {r['symbol']: float(r['markPrice']) for r in risks}
        positions = []
        for row in risks:
            qty = float(row['positionAmt'])
            if qty == 0:
                continue
            if row['positionSide'] != 'BOTH' or not row['symbol'].endswith('USDT'):
                raise TradeError('Unsupported account positions; USDT one-way account required')
            positions.append(dict(symbol=row['symbol'][:-4], side='long' if qty > 0 else 'short', size=abs(qty),
                                  notional=abs(qty * float(row['markPrice'])), entryPrice=float(row['entryPrice']),
                                  markPrice=float(row['markPrice']), unrealizedPnl=float(row['unRealizedProfit']),
                                  liquidationPrice=float(row['liquidationPrice']) or None, leverage=int(row['leverage'])))
        regular = self.call('GET', '/fapi/v1/openOrders')
        algos = self.call('GET', '/fapi/v1/openAlgoOrders')
        if isinstance(algos, dict):
            if not isinstance(algos.get('orders'), list):
                raise TradeError('Cannot confirm conditional open orders')
            algos = algos['orders']
        orders = []
        for row, algo in [(r, False) for r in regular] + [(r, True) for r in algos]:
            pair = row['symbol']
            if not pair.endswith('USDT'):
                raise TradeError('Unsupported pending contract')
            orders.append(dict(id=('algo:' + str(row['algoId'])) if algo else str(row['orderId']),
                               symbol=pair[:-4], side=row['side'].lower(), type=row.get('orderType', row.get('type', 'limit')),
                               price=float(row.get('price') or row.get('triggerPrice') or row.get('stopPrice') or 0) or None,
                               size=max(0, float(row.get('quantity') or row.get('origQty') or 0) - float(row.get('executedQty') or 0)),
                               reduceOnly=truth(row.get('reduceOnly')) or truth(row.get('closePosition')),
                               markPrice=marks.get(pair) or self.price(pair[:-4]),
                               clientOrderId=row.get('clientAlgoId') if algo else row.get('clientOrderId'),
                               status='open', createdAt=int(row.get('time') or row.get('createTime') or 0)))
        realized = Decimal(0)
        for kind in (('REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE') if include_pnl else ()):
            for page in range(1, 101):
                rows = self.call('GET', '/fapi/v1/income', {'incomeType': kind, 'startTime': int(since * 1000), 'limit': 1000, 'page': page})
                if any(r.get('asset', 'USDT') != 'USDT' for r in rows):
                    raise TradeError('Non-USDT fee/PnL history unsupported; disable fee-token discount')
                realized += sum((Decimal(r['income']) for r in rows), Decimal(0))
                if len(rows) < 1000:
                    break
            else:
                raise TradeError('Daily PnL history incomplete')
        return dict(equity=float(account['totalMarginBalance']), availableBalance=float(account['availableBalance']),
                    positions=positions, orders=orders, realized=float(realized))

    def submit(self, order):
        params = dict(symbol=order['symbol'] + 'USDT', side=order['side'].upper(), quantity=order['qty'], reduceOnly=str(order['reduceOnly']).lower())
        trigger = order.get('trigger')
        if trigger:
            params.update(algoType='CONDITIONAL', type='STOP_MARKET' if trigger == 'sl' else 'TAKE_PROFIT_MARKET',
                          triggerPrice=order['price'], workingType='MARK_PRICE', clientAlgoId=order['cid'])
            path = '/fapi/v1/algoOrder'
        else:
            params.update(type='LIMIT', price=order['price'], timeInForce=order['tif'],
                          newClientOrderId=order['cid'], newOrderRespType='RESULT', positionSide='BOTH')
            path = '/fapi/v1/order'
        try:
            response = self.call('POST', path, params)
        except ExchangeFailure as exc:
            if exc.code is not None and exc.code not in (-1006, -1007):
                return dict(id='', status='rejected', filled=0, price=0, warning=str(exc))
            raise
        if trigger:
            return dict(id='algo:' + str(response['algoId']), status='open', filled=0, price=0)
        return normalized_binance(response)

    def query(self, symbol, cid, trigger=False):
        try:
            if trigger:
                row = self.call('GET', '/fapi/v1/algoOrder', {'clientAlgoId': cid})
                actual = row.get('actualOrderId')
                if actual and str(actual) != '0':
                    executed = self.call('GET', '/fapi/v1/order', {'symbol': symbol + 'USDT', 'orderId': actual})
                    result = normalized_binance(executed)
                    result['id'] = 'algo:' + str(row['algoId'])
                    return result
                result = normalized_binance(row, True)
                # actualQty is requested child size, not proof that the child filled.
                result.update(filled=0, price=0)
                if result['status'] == 'filled':
                    result['status'] = 'uncertain'
                return result
            else:
                row = self.call('GET', '/fapi/v1/order', {'symbol': symbol + 'USDT', 'origClientOrderId': cid})
            return normalized_binance(row, trigger)
        except ExchangeFailure as exc:
            if exc.code in (-2013, -2011):
                return None  # Absence is NOT permission to resubmit.
            raise

    def cancel(self, symbol, order_id):
        if order_id.startswith('algo:'):
            self.call('DELETE', '/fapi/v1/algoOrder', {'algoId': order_id[5:]})
        else:
            self.call('DELETE', '/fapi/v1/order', {'symbol': symbol + 'USDT', 'orderId': order_id})
        return dict(id=order_id, status='cancel_requested')


def hl_tick(price, sz_decimals):
    # Perps: <= 5 significant figures OR integer, and <= 6-szDecimals fractional digits.
    digits = max(0, min(6 - sz_decimals, 5 - (Decimal(str(price)).adjusted() + 1)))
    return str(Decimal(1).scaleb(-digits))


class Hyperliquid:
    def __init__(self, account, private_key, testnet=False):
        # Optional SDK import is deliberately behind complete account configuration.
        logging.getLogger().setLevel(logging.WARNING)
        from eth_account import Account
        from hyperliquid.exchange import Exchange
        from hyperliquid.info import Info
        from hyperliquid.utils.types import Cloid
        self.Cloid = Cloid
        self.account = account
        base = 'https://api.hyperliquid-testnet.xyz' if testnet else 'https://api.hyperliquid.xyz'
        self.info = Info(base, skip_ws=True, timeout=8)
        self.exchange = Exchange(Account.from_key(private_key), base, account_address=account, timeout=8)
        self.universe = {}
        self.meta_at = 0

    def metadata(self, symbol):
        if not self.universe or time.monotonic() - self.meta_at > 300:
            self.universe = {r['name']: r for r in self.info.meta()['universe'] if not r.get('isDelisted')}
            self.meta_at = time.monotonic()
        matches = [s for s in self.universe if s.upper() == symbol.upper()]
        if len(matches) != 1:
            raise TradeError('No unambiguous Hyperliquid native perpetual symbol')
        symbol = matches[0]
        row = self.universe[symbol]
        step = str(Decimal(1).scaleb(-row['szDecimals']))
        return Metadata(symbol, step, hl_tick(self.price(symbol), row['szDecimals']), step, '10', min(5, row['maxLeverage']))

    def price(self, symbol):
        return float(self.info.all_mids()[symbol])

    def prepare(self, symbol, leverage):
        positions = self.info.user_state(self.account)['assetPositions']
        if any(p['position']['coin'] == symbol and float(p['position']['szi']) != 0 and p['position']['leverage']['type'] != 'isolated' for p in positions):
            raise TradeError('Existing Hyperliquid cross position; close explicitly first', 409)
        result = self.exchange.update_leverage(leverage, symbol, is_cross=False)
        if result.get('status') != 'ok':
            raise TradeError('Isolated leverage update rejected', 409)
        verify = self.info.user_state(self.account)['assetPositions']
        for item in verify:
            p = item['position']
            if p['coin'] == symbol and float(p['szi']) != 0 and (p['leverage']['type'] != 'isolated' or int(p['leverage']['value']) != leverage):
                raise TradeError('Cannot confirm isolated leverage', 409)

    def snapshot(self, since, *, include_pnl=True):
        state = self.info.user_state(self.account)
        positions = []
        for item in state['assetPositions']:
            p = item['position']
            qty = float(p['szi'])
            if qty == 0:
                continue
            positions.append(dict(symbol=p['coin'], side='long' if qty > 0 else 'short', size=abs(qty),
                                  notional=abs(float(p['positionValue'])), entryPrice=float(p['entryPx']),
                                  markPrice=abs(float(p['positionValue']) / qty), unrealizedPnl=float(p['unrealizedPnl']),
                                  liquidationPrice=float(p['liquidationPx']) if p.get('liquidationPx') else None,
                                  leverage=int(p['leverage']['value'])))
        mids = self.info.all_mids()
        orders = [dict(id=str(o['oid']), symbol=o['coin'], side='buy' if o['side'] == 'B' else 'sell',
                       type=o.get('orderType', 'limit'), price=float(o['limitPx']) or None, size=float(o['sz']),
                       reduceOnly=bool(o.get('reduceOnly', False)), clientOrderId=o.get('cloid'), status='open',
                       markPrice=float(mids[o['coin']]),
                       createdAt=int(o['timestamp'])) for o in self.info.frontend_open_orders(self.account)]
        fills = self.fills_since(int(since * 1000)) if include_pnl else []
        realized = sum(float(f['closedPnl']) - float(f['fee']) for f in fills)
        funding = self.info.user_funding_history(self.account, int(since * 1000)) if include_pnl else []
        if len(funding) >= 500:
            raise TradeError('Daily funding history incomplete')
        realized += sum(float(f['delta']['usdc']) for f in funding)
        return dict(equity=float(state['marginSummary']['accountValue']), availableBalance=float(state['withdrawable']),
                    positions=positions, orders=orders, realized=realized)

    def fills_since(self, start):
        collected = {}
        while True:
            rows = self.info.user_fills_by_time(self.account, start, aggregate_by_time=False)
            for row in rows:
                collected[(row['tid'], row['oid'])] = row
            if len(rows) < 2000:
                return list(collected.values())
            last = max(int(r['time']) for r in rows)
            if last <= start:
                raise TradeError('Fill history truncated; opening blocked')
            start = last  # inclusive; dedup by tid, never skip fills at the boundary

    def cloid(self, cid):
        return self.Cloid.from_str('0x' + hashlib.sha256(cid.encode()).hexdigest()[:32])

    def submit(self, order):
        meta = self.metadata(order['symbol'])
        tick = hl_tick(order['price'], self.universe[meta.symbol]['szDecimals'])
        price = rounded(order['price'], tick, up=order['side'] == 'sell')
        kind = ({'trigger': {'triggerPx': float(price), 'isMarket': True, 'tpsl': order['trigger']}}
                if order.get('trigger') else {'limit': {'tif': 'Ioc' if order['tif'] == 'IOC' else 'Gtc'}})
        response = self.exchange.order(meta.symbol, order['side'] == 'buy', float(order['qty']), float(price), kind,
                                       reduce_only=order['reduceOnly'], cloid=self.cloid(order['cid']))
        if response.get('status') != 'ok':
            return dict(id='', status='rejected', filled=0, price=0, warning='Hyperliquid order rejected')
        status = response['response']['data']['statuses'][0]
        if 'error' in status:
            return dict(id='', status='rejected', filled=0, price=0, warning='Hyperliquid rejected the order; check margin/market filters')
        if 'filled' in status:
            fill = status['filled']
            return dict(id=str(fill['oid']), status='filled', filled=float(fill['totalSz']), price=float(fill['avgPx']))
        if 'resting' in status:
            return dict(id=str(status['resting']['oid']), status='open', filled=0, price=0)
        return dict(id='', status='uncertain', filled=0, price=0, warning='Execution uncertain; query same client ID')

    def query(self, symbol, cid, trigger=False):
        response = self.info.query_order_by_cloid(self.account, self.cloid(cid))
        if response.get('status') == 'unknownOid':
            return None
        detail = response['order']
        row = detail['order']
        oid = row['oid']
        # Status order sizes are remaining sizes, never use origSz as a confirmed fill.
        fills = [f for f in self.fills_since(max(0, int(row['timestamp']) - 1000)) if f['oid'] == oid]
        qty = float(sum((Decimal(f['sz']) for f in fills), Decimal(0)))
        price = sum(float(f['sz']) * float(f['px']) for f in fills) / qty if qty else 0
        status = detail['status']
        mapped = ('filled' if status == 'filled' else 'open' if status in ('open', 'triggered') else
                  'rejected' if 'reject' in status.lower() else 'canceled' if 'cancel' in status.lower() else 'uncertain')
        if mapped == 'filled' and not qty:
            # An order can become filled before the fills endpoint includes its trades.
            # A terminal journal state would otherwise stop reconciliation and skip SL/TP.
            return dict(id=str(oid), status='uncertain', filled=0, price=0,
                        warning='Filled order trades not visible yet; reconciling before protection')
        return dict(id=str(oid), status='partial' if mapped == 'open' and qty else mapped, filled=qty, price=price,
                    fee=sum(float(f['fee']) for f in fills))

    def cancel(self, symbol, order_id):
        response = self.exchange.cancel(symbol, int(order_id))
        if response.get('status') != 'ok' or response['response']['data']['statuses'][0] != 'success':
            raise TradeError('Hyperliquid cancellation not confirmed', 502)
        return dict(id=order_id, status='cancel_requested')


def configured_adapters(env):
    adapters = {}
    if env.get('BINANCE_TRADE_API_KEY') and env.get('BINANCE_TRADE_API_SECRET'):
        adapters['binance'] = Binance(env['BINANCE_TRADE_API_KEY'], env['BINANCE_TRADE_API_SECRET'], env.get('BINANCE_TRADE_TESTNET', 'true').lower() == 'true')
    if env.get('HL_ACCOUNT_ADDRESS') and env.get('HL_AGENT_PRIVATE_KEY'):
        adapters['hyperliquid'] = Hyperliquid(env['HL_ACCOUNT_ADDRESS'], env['HL_AGENT_PRIVATE_KEY'], env.get('HL_TRADE_TESTNET', 'true').lower() == 'true')
    return adapters
