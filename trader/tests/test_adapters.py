import unittest
from unittest.mock import patch

from trader.adapters import Binance, Hyperliquid, ExchangeFailure, hl_tick, configured_adapters
from trader.core import TradeError


class AdapterTests(unittest.TestCase):
    def test_sdk_is_optional_without_configuration(self):
        self.assertEqual(configured_adapters({}), {})

    def test_binance_ioc_and_conditional_api(self):
        adapter = Binance('fake-key', 'fake-secret', True)
        calls = []
        def call(method, path, params):
            calls.append((method, path, params))
            return dict(algoId=12) if 'algoOrder' in path else dict(orderId=1, status='EXPIRED', executedQty='0.4', avgPrice='100')
        adapter.call = call
        plan = dict(cid='sh123', symbol='BTC', side='buy', qty='1', price='101', reduceOnly=False, tif='IOC')
        self.assertEqual(adapter.submit(plan)['filled'], .4)
        self.assertEqual(calls[0][2]['type'], 'LIMIT')
        self.assertEqual(calls[0][2]['timeInForce'], 'IOC')
        plan.update(trigger='sl', reduceOnly=True)
        self.assertEqual(adapter.submit(plan)['id'], 'algo:12')
        self.assertEqual(calls[1][1], '/fapi/v1/algoOrder')
        self.assertEqual(calls[1][2]['reduceOnly'], 'true')
        adapter.cancel('BTC', 'algo:12')
        self.assertEqual(calls[2][1], '/fapi/v1/algoOrder')

    def test_binance_precision_metadata_and_hedge_rejection(self):
        a = Binance('fake', 'fake')
        a.public = lambda _: dict(symbols=[dict(symbol='1000PEPEUSDT', contractType='PERPETUAL', status='TRADING',
            quoteAsset='USDT', marginAsset='USDT', filters=[dict(filterType='LOT_SIZE', stepSize='1', minQty='1', maxQty='999999'),
            dict(filterType='PRICE_FILTER', tickSize='.000001'), dict(filterType='MIN_NOTIONAL', notional='5')])])
        self.assertEqual(a.metadata('1000PEPE').symbol, '1000PEPE')
        with self.assertRaises(TradeError):
            a.metadata('PEPE')  # never silently multiply a requested asset
        a.call = lambda *args: {'dualSidePosition': True}
        with self.assertRaises(TradeError):
            a.prepare('1000PEPE', 3)

    def test_binance_error_mapping_never_uses_raw_exchange_text(self):
        self.assertNotIn('secret', str(ExchangeFailure(-2015)))
        a = Binance('fake', 'fake')
        a.call = lambda *args: (_ for _ in ()).throw(ExchangeFailure(-1007))
        with self.assertRaises(ExchangeFailure):
            a.submit(dict(symbol='BTC', side='buy', qty='1', price='100', reduceOnly=False, tif='IOC', cid='sh1'))

    def test_hl_funding_uses_pinned_official_sdk_method(self):
        class Info:
            def user_state(self, account):
                return dict(assetPositions=[], marginSummary={'accountValue': '1000'}, withdrawable='999')
            def frontend_open_orders(self, account):
                return []
            def all_mids(self):
                return {}
            def user_fills_by_time(self, *args, **kw):
                return [dict(tid=1, oid=2, closedPnl='-5', fee='1')]
            def user_funding_history(self, *args):
                return [{'delta': {'usdc': '-2'}}]
        a = Hyperliquid.__new__(Hyperliquid)
        a.account, a.info = 'fake', Info()
        self.assertEqual(a.snapshot(1)['realized'], -8)

    def test_hl_precision(self):
        for price, decimals, expected in [(12345, 3, '1'), (.123456, 3, '0.001'), (123.456, 2, '0.01'), (100001, 0, '1')]:
            self.assertEqual(hl_tick(price, decimals), expected)

    def test_binance_pending_orders_reserve_at_mark(self):
        a = Binance('fake', 'fake')
        def call(method, path, params=None):
            if path.endswith('/account'):
                return dict(totalMarginBalance='1000', availableBalance='900')
            if path.endswith('/dual'):
                return dict(dualSidePosition=False)
            if path.endswith('/multiAssetsMargin'):
                return dict(multiAssetsMargin=False)
            if path.endswith('/positionRisk'):
                return [dict(symbol='BTCUSDT', positionAmt='0', markPrice='100')]
            if path.endswith('/openOrders'):
                return [dict(symbol='BTCUSDT', orderId=2, side='BUY', price='1', origQty='1', type='LIMIT')]
            return []
        a.call = call
        self.assertEqual(a.snapshot(1)['orders'][0]['markPrice'], 100)

    def test_hl_fraction_fill_is_decimal_exact(self):
        class Info:
            def query_order_by_cloid(self, *args):
                return dict(status='order', order=dict(status='filled', order=dict(oid=1, timestamp=1)))
        a = Hyperliquid.__new__(Hyperliquid)
        a.account, a.info, a.cloid = 'fake', Info(), lambda cid: cid
        a.fills_since = lambda _: [dict(oid=1, sz='.1', px='100', fee='0'), dict(oid=1, sz='.2', px='100', fee='0')]
        self.assertEqual(a.query('BTC', 'fake')['filled'], .3)
        a.fills_since = lambda _: []
        self.assertEqual(a.query('BTC', 'fake')['status'], 'uncertain')

    def test_binance_trigger_fill_confirmed_from_actual_order(self):
        a = Binance('fake', 'fake')
        calls = []
        def call(method, path, params):
            calls.append((path, params))
            if path.endswith('/algoOrder'):
                return dict(algoId=12, algoStatus='FINISHED', actualOrderId='123', actualQty='5', actualPrice='100')
            return dict(orderId=123, status='FILLED', executedQty='2', avgPrice='100')
        a.call = call
        result = a.query('BTC', 'fake-stop', trigger=True)
        self.assertEqual(result['filled'], 2)
        self.assertEqual(result['id'], 'algo:12')
        self.assertEqual(calls[-1][1]['orderId'], '123')


if __name__ == '__main__':
    unittest.main()
