"""Optional installed-SDK contract check. All SDK HTTP calls are intercepted."""
import unittest
from unittest.mock import patch

try:
    import hyperliquid.api
    HAS_SDK = True
except ImportError:
    HAS_SDK = False

from trader.adapters import Hyperliquid


@unittest.skipUnless(HAS_SDK, 'Install trader/requirements.txt for official SDK contract checks')
class OfficialSdkTests(unittest.TestCase):
    def test_real_sdk_signing_and_method_contracts_without_network(self):
        actions = []
        def post(path, payload):
            if path == '/exchange':
                self.assertEqual(set(payload['signature']), {'r', 's', 'v'})
                actions.append(payload['action'])
                kind = payload['action']['type']
                if kind == 'order':
                    order = payload['action']['orders'][0]
                    status = {'resting': {'oid': 2}} if 'trigger' in order['t'] else {'filled': {'oid': 1, 'totalSz': '.5', 'avgPx': '100'}}
                    return {'status': 'ok', 'response': {'type': 'order', 'data': {'statuses': [status]}}}
                if kind == 'cancel':
                    return {'status': 'ok', 'response': {'type': 'cancel', 'data': {'statuses': ['success']}}}
                return {'status': 'ok', 'response': {'type': 'default'}}
            self.assertEqual(path, '/info')
            kind = payload['type']
            if kind == 'spotMeta':
                return {'universe': [], 'tokens': []}
            if kind == 'meta':
                return {'universe': [{'name': 'BTC', 'szDecimals': 3, 'maxLeverage': 50}]}
            if kind == 'allMids':
                return {'BTC': '100'}
            if kind == 'clearinghouseState':
                return {'assetPositions': [], 'marginSummary': {'accountValue': '1000'}, 'withdrawable': '999'}
            if kind == 'orderStatus':
                return {'status': 'unknownOid'}
            if kind in ('userFillsByTime', 'userFunding', 'frontendOpenOrders'):
                return []
            self.fail('Unexpected SDK read method')

        with patch('hyperliquid.api.API.post', side_effect=post):
            a = Hyperliquid('0x' + '22' * 20, '0x' + '11' * 32, testnet=True)
            self.assertEqual(a.metadata('BTC').step, '0.001')
            a.prepare('BTC', 3)
            order = dict(cid='synthetic-test-id', symbol='BTC', side='buy', qty='.5', price='101', tif='IOC', reduceOnly=False)
            self.assertEqual(a.submit(order)['filled'], .5)
            self.assertEqual(actions[-1]['orders'][0]['t'], {'limit': {'tif': 'Ioc'}})
            self.assertTrue(actions[-1]['orders'][0]['c'].startswith('0x'))
            order.update(cid='synthetic-stop-id', side='sell', price='97', trigger='sl', reduceOnly=True)
            self.assertEqual(a.submit(order)['status'], 'open')
            self.assertTrue(actions[-1]['orders'][0]['r'])
            self.assertEqual(actions[-1]['orders'][0]['t']['trigger']['tpsl'], 'sl')
            self.assertIsNone(a.query('BTC', 'synthetic-test-id'))
            self.assertEqual(a.snapshot(1)['realized'], 0)
            self.assertEqual(a.cancel('BTC', '2')['status'], 'cancel_requested')


if __name__ == '__main__':
    unittest.main()
