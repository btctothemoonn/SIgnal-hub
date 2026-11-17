import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ADMIN_SESSION_COOKIE, isAdminAuthConfigured, verifyAdminSessionToken } from './admin-auth.ts';

type Env = Record<string, string | undefined>;
export const PIN_COOKIE = 'signal_hub_trade';
export const CSRF_COOKIE = 'signal_hub_trade_csrf';
const TTL = 8 * 60 * 60;

export class TradeHttpError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}

export function cookieValue(request: Request, name: string): string {
  const values = (request.headers.get('cookie') || '').split(';').map(p => p.trim())
    .filter(p => p.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

export class TradeAuth {
  private boot = randomBytes(24).toString('hex');
  private revoked = new Map<string, number>();
  private failures = 0;
  private windowStart = 0;
  constructor(private env: Env = process.env, private clock = Date.now) {}

  private secret(): string {
    const value = this.env.TRADER_SESSION_SECRET || '';
    if (value.length < 32 || value === this.env.ADMIN_SESSION_SECRET) {
      throw new TradeHttpError('Trade unlock authentication is not configured', 503);
    }
    return value;
  }
  private sign(value: string): string { return createHmac('sha256', this.secret()).update(value).digest('base64url'); }

  session(request: Request): string {
    const token = cookieValue(request, ADMIN_SESSION_COOKIE);
    if (!isAdminAuthConfigured(this.env) || !verifyAdminSessionToken(token, this.env, this.clock())) {
      throw new TradeHttpError('Website login required', 401);
    }
    return digest(token);
  }

  csrf(session: string): string {
    return createHmac('sha256', this.env.ADMIN_SESSION_SECRET || this.secret()).update('trade-csrf:' + session).digest('base64url');
  }

  write(request: Request, requireUnlock = true): string {
    const session = this.session(request);
    // Never trust arbitrary X-Forwarded-* headers for a financial write boundary.
    let expected: string;
    try { expected = new URL(this.env.TRADER_PUBLIC_ORIGIN || request.url).origin; }
    catch { throw new TradeHttpError('Trade origin is not configured', 503); }
    const origin = request.headers.get('origin');
    if (!origin || origin === 'null' || origin !== expected || (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) {
      throw new TradeHttpError('Same origin required');
    }
    const csrf = request.headers.get('x-csrf-token') || '';
    if (!equal(csrf, this.csrf(session)) || !equal(csrf, cookieValue(request, CSRF_COOKIE))) {
      throw new TradeHttpError('Invalid CSRF token');
    }
    if (requireUnlock && !this.unlocked(session, cookieValue(request, PIN_COOKIE))) {
      throw new TradeHttpError('Trade unlock required');
    }
    return session;
  }

  private payload(token: string): { session: string; iat: number; exp: number; nonce: string; boot: string; pin: string } | null {
    try {
      if (token.length > 2048) return null;
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra || !equal(signature, this.sign(body))) return null;
      const value = JSON.parse(Buffer.from(body, 'base64url').toString());
      const now = Math.floor(this.clock() / 1000);
      if (!Number.isInteger(value.iat) || !Number.isInteger(value.exp) || value.iat > now || value.exp <= now ||
          value.exp - value.iat !== TTL || value.boot !== this.boot || value.pin !== digest(this.env.TRADER_PIN_HASH || '') ||
          typeof value.nonce !== 'string' || typeof value.session !== 'string') return null;
      return value;
    } catch { return null; }
  }

  unlocked(session: string, token: string): boolean {
    const payload = this.payload(token);
    return !!payload && equal(session, payload.session) && !this.revoked.has(payload.nonce);
  }

  async unlock(request: Request, pin: unknown): Promise<string> {
    const session = this.write(request, false);
    const hash = this.env.TRADER_PIN_HASH || '';
    const match = /^scrypt\$([a-zA-Z0-9_-]{16,64})\$([a-f0-9]{64})$/.exec(hash);
    if (!match) throw new TradeHttpError('Trade PIN hash is not configured', 503);
    const now = this.clock();
    if (now - this.windowStart >= 15 * 60000) { this.windowStart = now; this.failures = 0; }
    if (this.failures >= 5) throw new TradeHttpError('Too many PIN attempts; wait 15 minutes', 429);
    this.failures++; // Reserve before async scrypt: parallel attempts cannot bypass the limit.
    if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) throw new TradeHttpError('Invalid trade PIN');
    const key = await new Promise<Buffer>((resolve, reject) => {
      scrypt(pin, match[1], 32, { N: 16384, r: 8, p: 1 }, (error, result) => error ? reject(error) : resolve(result));
    });
    if (!timingSafeEqual(key, Buffer.from(match[2], 'hex'))) throw new TradeHttpError('Invalid trade PIN');
    this.failures = 0;
    const iat = Math.floor(now / 1000);
    const body = Buffer.from(JSON.stringify({ session, iat, exp: iat + TTL, nonce: randomBytes(24).toString('hex'),
      boot: this.boot, pin: digest(hash) })).toString('base64url');
    return body + '.' + this.sign(body);
  }

  lock(token: string): void {
    for (const [nonce, expiry] of this.revoked) if (expiry <= this.clock() / 1000) this.revoked.delete(nonce);
    const payload = this.payload(token);
    if (payload) this.revoked.set(payload.nonce, payload.exp);
  }

  cookie(name: string, value: string, clear = false): string {
    const secure = this.env.NODE_ENV === 'production' || this.env.TRADER_PUBLIC_ORIGIN?.startsWith('https:');
    return `${name}=${value}; Path=/api/trade; Max-Age=${clear ? 0 : TTL}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }
}

// Next development reloads retain throttles/revocations within the one web process.
const state = globalThis as typeof globalThis & { signalHubTradeAuth?: TradeAuth };
export const tradeAuth = state.signalHubTradeAuth ??= new TradeAuth();
