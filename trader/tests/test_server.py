import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from trader.core import Engine
from trader.server import handler


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = Engine(Path(self.tmp.name) / 'db.sqlite', {})
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.engine, 't' * 32))
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.engine.close()
        self.tmp.cleanup()

    def request(self, path, body=None, token='t' * 32, **headers):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        conn.request('GET' if body is None else 'POST', path, body=body,
                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', **headers})
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response.status, json.loads(data)

    def test_auth_readonly_and_contract(self):
        self.assertEqual(self.request('/status', token='bad')[0], 401)
        code, data = self.request('/status')
        self.assertEqual(code, 200)
        self.assertEqual(len(data['accounts']), 2)
        self.assertNotIn('csrfToken', data)
        self.assertNotIn('unlocked', data)
        self.assertEqual(self.request('/order', '{}')[0], 403)

    def test_json_size_and_sanitized_errors(self):
        self.assertEqual(self.request('/order', '{')[0], 400)
        self.assertEqual(self.request('/order', 'NaN')[0], 400)
        self.assertEqual(self.request('/order', 'x' * 16385)[0], 413)
        self.engine.status = lambda: (_ for _ in ()).throw(RuntimeError('SECRET credentials'))
        code, data = self.request('/status')
        self.assertEqual(code, 503)
        self.assertNotIn('SECRET', json.dumps(data))


if __name__ == '__main__':
    unittest.main()
