import type { TradeStatus, TradeVenue } from './news-terminal-types.ts';
import { TradeAuth, tradeAuth, TradeHttpError, cookieValue, PIN_COOKIE, CSRF_COOKIE } from './trade-auth.ts';

type Action = 'status' | 'unlock' | 'lock' | 'order' | 'cancel' | 'close-all';
type Env = Record<string, string | undefined>;
type Fill = { id: string; venue: TradeVenue; symbol: string; side: 'buy' | 'sell'; price: number; size: number; createdAt: number; fee: number | null };
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, noarchive' };

export function offlineStatus(): Omit<TradeStatus, 'csrfToken' | 'unlocked'> {
  return { enabled: false, mode: 'readonly', limits: { maxOrderNotional: 500, maxSymbolNotional: 1000,
    maxTotalNotional: 3000, maxLeverage: 5, maxDailyLoss: 200, slippagePct: 1 },
  accounts: (['binance', 'hyperliquid'] as const).map(venue => ({ venue, configured: false, connected: false,
    availableBalance: null, equity: null, positions: [], orders: [], error: 'Trader service unavailable', updatedAt: null })),
  logs: [], error: 'Trader service unavailable; trading disabled' };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new TradeHttpError('JSON body required', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new TradeHttpError('JSON body required', 400);
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) { await reader.cancel(); throw new TradeHttpError('Request too large', 413); }
    parts.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new TradeHttpError('Invalid JSON body', 400); }
}

function upstreamUrl(env: Env, action: Action): string {
  let url: URL;
  try { url = new URL(env.TRADER_URL || 'http://127.0.0.1:8766'); }
  catch { throw new TradeHttpError('Trader connection is not configured', 503); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || (env.TRADER_INTERNAL_TOKEN || '').length < 32) {
    throw new TradeHttpError('Trader must use an authenticated loopback connection', 503);
  }
  return new URL('/' + action, url).href;
}

export async function handleTrade(request: Request, action: Action, options: {
  auth?: TradeAuth; env?: Env; fetch?: typeof fetch;
} = {}): Promise<Response> {
  const auth = options.auth || tradeAuth, env = options.env || process.env;
  const fetcher = options.fetch || fetch;
  const respond = (value: unknown, status = 200) => Response.json(value, { status, headers });
  try {
    if (request.method !== (action === 'status' ? 'GET' : 'POST')) return respond({ error: 'Method not allowed' }, 405);
    const session = action === 'status' ? auth.session(request) : auth.write(request, action !== 'unlock' && action !== 'lock');
    if (action === 'unlock') {
      const data = await body(request);
      if (Object.keys(data).length !== 1 || !('pin' in data)) throw new TradeHttpError('Invalid unlock body', 400);
      const token = await auth.unlock(request, data.pin);
      const response = respond({ unlocked: true });
      response.headers.append('Set-Cookie', auth.cookie(PIN_COOKIE, token));
      return response;
    }
    if (action === 'lock') {
      auth.lock(cookieValue(request, PIN_COOKIE));
      const response = respond({ unlocked: false });
      response.headers.append('Set-Cookie', auth.cookie(PIN_COOKIE, '', true));
      return response;
    }
    const data = action === 'status' ? undefined : await body(request);
    let upstream: Response;
    try {
      upstream = await fetcher(upstreamUrl(env, action), { method: action === 'status' ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + env.TRADER_INTERNAL_TOKEN, 'Content-Type': 'application/json' },
        body: data ? JSON.stringify(data) : undefined, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(action === 'status' ? 30000 : 90000) });
    } catch {
      if (action !== 'status') return respond({ error: 'Trader response unavailable. Execution may be uncertain; query the SAME clientOrderId before retrying. Do not create a new order ID.' }, 503);
      upstream = Response.json(offlineStatus());
    }
    if (!upstream.ok) {
      const status = [400, 403, 409, 429, 502, 503].includes(upstream.status) ? upstream.status : 502;
      // Only the Python service emits these fixed, sanitized validation/risk messages.
      const errorBody = await upstream.json().catch(() => null);
      const error = errorBody?.safe === true && typeof errorBody.error === 'string' && errorBody.error.length < 250
        ? errorBody.error : 'Trader rejected the request; refresh status and inspect sanitized service logs';
      return respond({ error }, status);
    }
    const value = await upstream.json();
    if (action === 'status') {
      if (!value || typeof value.enabled !== 'boolean' || !['live', 'readonly'].includes(value.mode) || !Array.isArray(value.accounts) || !value.limits || !Array.isArray(value.logs)) {
        throw new TradeHttpError('Invalid trader status response', 502);
      }
      const fills: Fill[] = Array.isArray(value.fills) ? value.fills.slice(0, 100).map((fill: Record<string, unknown>) => {
        if (typeof fill.id !== 'string' || typeof fill.symbol !== 'string' || (fill.venue !== 'binance' && fill.venue !== 'hyperliquid') ||
            (fill.side !== 'buy' && fill.side !== 'sell') || typeof fill.price !== 'number' || !Number.isFinite(fill.price) ||
            typeof fill.size !== 'number' || !Number.isFinite(fill.size) || typeof fill.createdAt !== 'number' || !Number.isFinite(fill.createdAt) ||
            (fill.fee !== null && (typeof fill.fee !== 'number' || !Number.isFinite(fill.fee)))) throw new TradeHttpError('Invalid trader fills response', 502);
        return { id: fill.id, venue: fill.venue, symbol: fill.symbol, side: fill.side, price: fill.price,
          size: fill.size, createdAt: fill.createdAt, fee: fill.fee };
      }) : [];
      const status: TradeStatus & { fills: Fill[] } = { enabled: value.enabled, mode: value.mode, accounts: value.accounts, fills,
        limits: value.limits, logs: value.logs, error: value.error || null,
        csrfToken: auth.csrf(session), unlocked: auth.unlocked(session, cookieValue(request, PIN_COOKIE)) };
      const response = respond(status);
      response.headers.append('Set-Cookie', auth.cookie(CSRF_COOKIE, status.csrfToken));
      return response;
    }
    return respond(value);
  } catch (error) {
    return respond({ error: error instanceof TradeHttpError ? error.message : 'Trade request unavailable' },
      error instanceof TradeHttpError ? error.status : 503);
  }
}
