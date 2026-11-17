import copy
import tempfile
import unittest
import threading
from pathlib import Path

from trader.core import Engine, TradeError, Metadata


class Fake:
    def __init__(self):
        self.state = dict(equity=5000, availableBalance=5000, positions=[], orders=[], realized=0)
        self.sent = []
        self.results = {}
        self.timeout = False
        self.protection_fail = False
        self.fill = 1

    def snapshot(self, since, *, include_pnl=True):
        return copy.deepcopy(self.state)

    def metadata(self, symbol):
        if symbol != 'BTC':
            raise TradeError('Unsupported symbol')
        return Metadata('BTC', '0.001', '0.1', '0.001', '5', 5)

    def price(self, symbol):
        return 100

    def prepare(self, symbol, leverage):
        pass

    def submit(self, order):
        self.sent.append(copy.deepcopy(order))
        if order.get('trigger') and self.protection_fail:
            raise TimeoutError('SECRET')
        if self.timeout:
            raise TimeoutError('SECRET')
        qty = float(order['qty']) * self.fill if not order.get('trigger') else 0
        result = dict(id=str(len(self.sent)), status='filled' if self.fill == 1 else 'canceled', filled=qty, price=100)
        self.results[order['cid']] = result
        return result

    def query(self, symbol, cid, trigger=False):
        return self.results.get(cid)

    def cancel(self, symbol, order_id):
        self.state['orders'] = [o for o in self.state['orders'] if o['id'] != order_id]
        return dict(id=order_id, status='canceled')


def position(size=1, side='long', symbol='BTC'):
    return dict(symbol=symbol, side=side, size=size, notional=size * 100,
                entryPrice=100, markPrice=100, unrealizedPnl=0, liquidationPrice=None, leverage=3)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.a, self.b = Fake(), Fake()
        self.now = 1800000000
        self.engine = Engine(Path(self.tmp.name) / 'trades.sqlite', {'binance': self.a, 'hyperliquid': self.b},
                             enabled=True, mode='live', clock=lambda: self.now)

    def tearDown(self):
        self.engine.close()
        self.tmp.cleanup()

    def request(self, **kw):
        return dict(clientOrderId='manual-1', venue='binance', symbol='BTC', side='buy', type='market',
                    notional=100, leverage=3, **kw)

    def test_defaults_off_and_status_contract(self):
        other = Engine(Path(self.tmp.name) / 'off.sqlite', {})
        self.assertFalse(other.status()['enabled'])
        self.assertEqual(other.status()['mode'], 'readonly')
        with self.assertRaises(TradeError):
            other.place(self.request())
        other.close()

    def test_ioc_and_idempotency(self):
        first = self.engine.place(self.request())
        self.assertEqual(self.engine.place(self.request()), first)
        self.assertEqual(len(self.a.sent), 1)
        self.assertEqual(self.a.sent[0]['tif'], 'IOC')
        self.assertLessEqual(float(self.a.sent[0]['price']), 101)
        changed = self.request()
        changed['notional'] = 200
        with self.assertRaises(TradeError):
            self.engine.place(changed)

    def test_timeout_queries_never_resubmits_even_after_restart(self):
        self.a.timeout = True
        result = self.engine.place(self.request())
        self.assertEqual(result['status'], 'uncertain')
        self.engine.close()
        self.engine = Engine(Path(self.tmp.name) / 'trades.sqlite', {'binance': self.a, 'hyperliquid': self.b},
                             enabled=True, mode='live', clock=lambda: self.now)
        self.assertEqual(self.engine.place(self.request())['status'], 'uncertain')
        self.assertEqual(len(self.a.sent), 1)
        self.a.results[self.a.sent[0]['cid']] = dict(id='1', status='filled', filled=1, price=100)
        self.assertEqual(self.engine.place(self.request())['status'], 'filled')
        self.assertEqual(len(self.a.sent), 1)

    def test_reduce_fraction_uses_position_and_bypasses_open_limits(self):
        self.a.state['positions'] = [position(20)]
        self.a.state['realized'] = -999
        req = self.request(reduceOnly=True, closeFraction=.5)
        req.update(side='sell', notional=999999)
        self.engine.place(req)
        self.assertEqual(float(self.a.sent[0]['qty']), 10)
        self.assertTrue(self.a.sent[0]['reduceOnly'])

    def test_opposite_open_and_wrong_reduce_rejected(self):
        self.a.state['positions'] = [position(side='short')]
        with self.assertRaises(TradeError):
            self.engine.place(self.request())
        with self.assertRaises(TradeError):
            self.engine.place(self.request(reduceOnly=True, closeFraction=1, clientOrderId2='bad'))

    def test_pending_other_account_counts_in_risk(self):
        self.b.state['orders'] = [dict(id='9', symbol='BTC', side='buy', type='limit', price=100,
                                      size=10, status='open', createdAt=1, reduceOnly=False)]
        with self.assertRaises(TradeError):
            self.engine.place(self.request())

    def test_partial_fill_protected_actual_qty_and_failure_visible(self):
        self.a.fill = .4
        self.a.protection_fail = True
        result = self.engine.place(self.request(stopLossPct=3, takeProfitPct=6))
        self.assertIn('PROTECTION', result['warning'])
        self.assertAlmostEqual(float(self.a.sent[1]['qty']), round(float(self.a.sent[0]['qty']) * .4, 3))
        self.assertTrue(self.a.sent[1]['reduceOnly'])
        self.engine.status()
        self.assertEqual(len(self.a.sent), 3)
        self.assertIn('PROTECTION', self.engine.status()['error'])

    def test_limits_and_validation(self):
        for field, value in [('notional', 501), ('notional', float('nan')), ('leverage', 6),
                             ('leverage', 1.5), ('notional', 1), ('symbol', 'UNKNOWN'),
                             ('stopLossPct', 101), ('reduceOnly', 'yes'), ('closeFraction', .5)]:
            req = self.request()
            req[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(TradeError):
                self.engine.place(req)
        self.assertEqual(self.a.sent, [])

    def test_duplicate_and_rate_limits(self):
        self.engine.place(self.request())
        req = self.request()
        req['clientOrderId'] = 'manual-2'
        with self.assertRaises(TradeError):
            self.engine.place(req)
        for i in range(1, 10):
            self.now += 5
            req['side'] = 'sell' if i % 2 else 'buy'
            req['clientOrderId'] = f'rate-id-{i}'
            self.engine.place(req)
        self.now += 5
        req['clientOrderId'] = 'rate-over'
        with self.assertRaises(TradeError):
            self.engine.place(req)

    def test_daily_loss_latches_and_persists(self):
        self.engine.status()
        self.a.state['realized'] = -201
        with self.assertRaises(TradeError):
            self.engine.place(self.request())
        self.a.state['realized'] = 1000
        with self.assertRaises(TradeError):
            self.engine.place(self.request())
        self.now += 86400
        self.a.state['realized'] = 0
        self.engine.place(self.request())

    def test_close_all_explicit_venue_and_reports_partial(self):
        self.a.state['positions'] = [position()]
        self.b.state['positions'] = [position()]
        with self.assertRaises(TradeError):
            self.engine.close_all({})
        result = self.engine.close_all({'venue': 'binance'})
        self.assertFalse(result['ok'])  # fake leaves the position open: never claim flat
        self.assertEqual(self.b.sent, [])
        self.assertTrue(self.a.sent[0]['reduceOnly'])

    def test_protection_recovers_confirmed_fill_after_crash(self):
        result = self.engine.place(self.request(stopLossPct=3))
        self.engine.db.execute('DELETE FROM protections')
        self.engine.db.execute('UPDATE intents SET protected=0')
        self.a.state['positions'] = [position()]
        self.a.sent.clear()
        self.engine.sync()
        self.assertEqual(len(self.a.sent), 1)
        self.assertEqual(self.a.sent[0]['trigger'], 'sl')

    def test_protection_metadata_failure_is_visible_after_actual_fill(self):
        original = self.a.metadata
        def metadata(symbol):
            if self.a.sent:
                raise TimeoutError('SECRET')
            return original(symbol)
        self.a.metadata = metadata
        result = self.engine.place(self.request(stopLossPct=3))
        self.assertIn('PROTECTION', result['protectionError'])

    def test_delayed_limit_fill_gets_protection_once(self):
        self.a.fill = 0
        req = self.request(stopLossPct=3)
        req.update(type='limit', limitPrice=99)
        self.a.submit = lambda order: self.a.sent.append(copy.deepcopy(order)) or dict(id='1', status='open', filled=0, price=0)
        result = self.engine.place(req)
        self.assertIn('PENDING', result['warning'])
        self.a.results[self.a.sent[0]['cid']] = dict(id='1', status='partial', filled=.2, price=99)
        self.engine.status()
        self.assertEqual(len(self.a.sent), 2)
        self.engine.status()
        self.assertEqual(len(self.a.sent), 2)

    def test_concurrent_same_id_submits_once_and_process_lock(self):
        results = []
        threads = [threading.Thread(target=lambda: results.append(self.engine.place(self.request()))) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(results), 4)
        self.assertEqual(len(self.a.sent), 1)
        with self.assertRaises(TradeError):
            Engine(Path(self.tmp.name) / 'trades.sqlite', {})

    def test_same_asset_multiplier_alias_counts_symbol_exposure(self):
        self.b.state['positions'] = [position(10, symbol='kPEPE')]
        self.a.metadata = lambda _: Metadata('1000PEPE', '.001', '.1', '.001', '5', 5)
        req = self.request()
        req['symbol'] = '1000PEPE'
        with self.assertRaises(TradeError):
            self.engine.place(req)

    def test_uncertain_reduce_does_not_repeat_with_new_id(self):
        self.a.state['positions'] = [position()]
        self.a.timeout = True
        req = self.request(reduceOnly=True)
        req['side'] = 'sell'
        self.assertEqual(self.engine.place(req)['status'], 'uncertain')
        req['clientOrderId'] = 'new-close-id'
        with self.assertRaises(TradeError):
            self.engine.place(req)
        self.assertEqual(len(self.a.sent), 1)

    def test_stale_protection_or_opposite_pending_blocks_new_position(self):
        for reduce_only in (True, False):
            self.a.state['orders'] = [dict(id='9', symbol='BTC', side='sell', type='limit', price=100,
                                          size=1, status='open', createdAt=1, reduceOnly=reduce_only)]
            with self.subTest(reduce_only=reduce_only), self.assertRaises(TradeError):
                self.engine.place(self.request())

    def test_total_limit_other_assets_and_unrealized_loss(self):
        self.b.state['positions'] = [position(29.5, symbol='ETH')]
        with self.assertRaisesRegex(TradeError, 'Total'):
            self.engine.place(self.request())
        self.b.state['positions'] = [dict(position(), unrealizedPnl=-201)]
        with self.assertRaisesRegex(TradeError, 'Daily'):
            self.engine.place(self.request())

    def test_close_all_cannot_claim_success_with_uncertain_open_intent(self):
        self.a.timeout = True
        self.engine.place(self.request())
        result = self.engine.close_all({'venue': 'binance'})
        self.assertFalse(result['ok'])

    def test_exposure_uses_mark_for_pending_low_limit_orders(self):
        self.b.state['orders'] = [dict(id='9', symbol='BTC', side='buy', type='limit', price=1,
                                      markPrice=100, size=10, status='open', createdAt=1, reduceOnly=False)]
        with self.assertRaises(TradeError):
            self.engine.place(self.request())

    def test_confirmed_protection_query_resolves_warning_without_resubmission(self):
        self.a.protection_fail = True
        result = self.engine.place(self.request(stopLossPct=3))
        self.assertIn('PROTECTION', result['protectionError'])
        leg = self.a.sent[-1]
        self.a.results[leg['cid']] = dict(id='2', status='open', filled=0, price=0)
        self.engine.sync()
        self.assertIsNone(self.engine.status()['error'])
        result = self.engine.place(self.request(stopLossPct=3))
        self.assertNotIn('protectionError', result)
        self.assertEqual(len(self.a.sent), 2)

    def test_fill_ledger_deduplicates_reconciliation(self):
        self.engine.place(self.request())
        self.engine.status()
        self.engine.place(self.request())
        rows = self.engine.db.execute('SELECT * FROM fills').fetchall()
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]['quantity'], float(self.a.sent[0]['qty']))
        fill = self.engine.status()['fills'][0]
        self.assertEqual(fill['venue'], 'binance')
        self.assertEqual(fill['symbol'], 'BTC')
        self.assertEqual(fill['side'], 'buy')
        self.assertIsNone(fill['fee'])
        self.assertEqual(set(fill), {'id', 'venue', 'symbol', 'side', 'price', 'size', 'createdAt', 'fee'})

    def test_status_cache_never_used_for_execution_checks(self):
        calls = []
        original = self.a.snapshot
        self.a.snapshot = lambda since, **kw: calls.append(kw) or original(since, **kw)
        self.engine.status()
        self.engine.status()
        self.assertEqual(len(calls), 1)
        self.a.state['positions'] = [position(side='short')]
        with self.assertRaises(TradeError):
            self.engine.place(self.request())
        self.assertEqual(len(calls), 2)
        self.now += 11
        self.assertEqual(self.engine.status()['accounts'][0]['positions'][0]['side'], 'short')

    def test_reduce_and_cancel_do_not_require_income_history(self):
        self.a.state['positions'] = [position()]
        original = self.a.snapshot
        def snapshot(since, *, include_pnl=True):
            if include_pnl:
                raise TimeoutError('history unavailable')
            return original(since)
        self.a.snapshot = snapshot
        req = self.request(reduceOnly=True)
        req['side'] = 'sell'
        self.assertEqual(self.engine.place(req)['status'], 'filled')

    def test_uncertain_protection_acknowledgement_is_never_reported_active(self):
        original = self.a.submit
        def submit(order):
            if order.get('trigger'):
                self.a.sent.append(copy.deepcopy(order))
                return dict(id='', status='uncertain', filled=0, price=0)
            return original(order)
        self.a.submit = submit
        result = self.engine.place(self.request(stopLossPct=3))
        self.assertEqual(result['protectionStatus'], 'uncertain')
        self.assertIn('PROTECTION', result['protectionError'])
        self.engine.status()
        self.assertEqual(len(self.a.sent), 2)

    def test_late_fill_while_readonly_does_not_claim_protection_active(self):
        self.a.timeout = True
        self.engine.place(self.request(stopLossPct=3))
        self.engine.mode = 'readonly'
        self.a.results[self.a.sent[0]['cid']] = dict(id='1', status='filled', filled=.5, price=100)
        status = self.engine.status()
        self.assertIn('PROTECTION', status['error'])
        self.assertEqual(len(self.a.sent), 1)


if __name__ == '__main__':
    unittest.main()
