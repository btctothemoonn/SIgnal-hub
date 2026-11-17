"""Loopback-only HTTP boundary; exchange credentials exist only in this process."""
import hmac
import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .adapters import configured_adapters
from .core import Engine, LIMITS, TradeError


def handler(engine, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def reply(self, status, value):
            data = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(data)
            except OSError:
                pass

        def execute(self):
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                return self.reply(401, {'error': 'Internal authentication required'})
            try:
                if self.command == 'GET' and self.path == '/status':
                    return self.reply(200, engine.status())
                methods = {'/order': engine.place, '/cancel': engine.cancel, '/close-all': engine.close_all}
                if self.command != 'POST' or self.path not in methods:
                    return self.reply(404, {'error': 'Not found'})
                if self.headers.get('Transfer-Encoding') or self.headers.get_content_type() != 'application/json':
                    raise TradeError('A fixed-length JSON body is required', 415)
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    raise TradeError('Invalid content length') from None
                if not 0 < length <= 16384:
                    raise TradeError('Request too large or empty', 413)
                try:
                    req = json.loads(self.rfile.read(length), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                except (ValueError, UnicodeError):
                    raise TradeError('Invalid JSON body') from None
                result = methods[self.path](req)
                return self.reply(200, result)
            except TradeError as exc:
                return self.reply(exc.status, {'error': str(exc), 'safe': True})
            except Exception:
                return self.reply(503, {'error': 'Trader operation unavailable; refresh status before retrying', 'safe': True})

        do_GET = execute
        do_POST = execute
    return Handler


def main():
    logging.disable(logging.CRITICAL)
    env = os.environ
    token = env.get('TRADER_INTERNAL_TOKEN', '')
    if len(token) < 32:
        raise SystemExit('A 32+ character internal token is required')
    limits = {key: float(env.get('TRADER_' + ''.join('_' + c if c.isupper() else c for c in key).upper(), default))
              for key, default in LIMITS.items()}
    try:
        engine = Engine(env.get('TRADER_DB_PATH', '.signal-hub/trader/trades.sqlite'), configured_adapters(env),
                        enabled=env.get('TRADING_ENABLED', 'false').lower() == 'true',
                        mode=env.get('TRADING_MODE', 'readonly'), limits=limits)
    except Exception:
        raise SystemExit('Trader startup configuration unavailable; check private environment and optional SDK installation') from None
    stop = threading.Event()

    def poll():
        while not stop.wait(10):
            try:
                engine.status()
            except Exception:
                pass

    server = ThreadingHTTPServer(('127.0.0.1', int(env.get('TRADER_PORT', '8766'))), handler(engine, token))
    server.daemon_threads = True
    thread = threading.Thread(target=poll, daemon=True)
    thread.start()
    try:
        server.serve_forever(poll_interval=.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        thread.join(timeout=10)
        # The OS releases the process lock on exit, including interrupted SDK calls.


if __name__ == '__main__':
    main()
