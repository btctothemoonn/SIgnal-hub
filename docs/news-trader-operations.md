# Manual Trader Operations

## Isolation And Setup

Python 3.11+; one trader process and one Next.js worker per account set. No exchange
keys in the web environment, repository, browser, chat, or command-line arguments.
Use a dedicated Linux `signal-hub-trader` user. Give it read/traverse access to the
repository/venv (and `/home/ubuntu`), but not the web `.env` files. Do not run as
the web user. Root owns `/etc/signal-hub/trader.env`, mode 600; systemd reads it.

```sh
python3 -m venv trader/.venv
trader/.venv/bin/pip install -r trader/requirements.txt
node scripts/trader-pin-hash.mjs
```

The PIN tool prompts without echo; store its output literally, not shell-expanded.
Generate two independent random secrets of 32+ characters for the internal token
and unlock signing secret. Existing website login must also be configured.

Trader-only environment (`/etc/signal-hub/trader.env`):

```ini
TRADER_INTERNAL_TOKEN=<random token shared with web>
TRADING_ENABLED=false
TRADING_MODE=readonly
BINANCE_TRADE_TESTNET=true
HL_TRADE_TESTNET=true
# Add only when available; incomplete pairs stay unconfigured:
BINANCE_TRADE_API_KEY=
BINANCE_TRADE_API_SECRET=
HL_ACCOUNT_ADDRESS=
HL_AGENT_PRIVATE_KEY=
```

Web-only environment: `TRADER_URL=http://127.0.0.1:8766`,
`TRADER_INTERNAL_TOKEN` (same token), `TRADER_PUBLIC_ORIGIN=https://your-host`,
`TRADER_SESSION_SECRET` (different from the login signing secret),
`TRADER_PIN_HASH=scrypt$<salt>$<hex>`. Never use `NEXT_PUBLIC_` for these values.
Install `deploy/systemd/signal-hub-trader.service` into `/etc/systemd/system/`,
then `systemctl daemon-reload && systemctl enable --now signal-hub-trader`.
Create the virtual environment under the stable checkout at
`/home/ubuntu/signal-hub/trader/.venv`. The systemd unit imports the code from
`/home/ubuntu/signal-hub-current`. Restart the optional service after activating
a release containing trader changes.
It binds only 127.0.0.1:8766; do not expose/forward this port. For local inspection,
run `python -m trader.server` with only the trader environment in that process.

## Accounts And Release Gate

Binance: dedicated USDM subaccount, USDT collateral, one-way mode, IP allowlist,
read/futures only. No withdrawals/transfers/spot. Existing cross positions are
rejected for opening; the service sets and verifies isolated leverage.
Hyperliquid: authorized API/agent wallet private key plus the **trading account**
address, not the agent address. Mainnet/testnet authorizations are separate.
Only native perpetual symbols are supported (e.g. `1000PEPE` on Binance, `kPEPE`
on HL); no speculative symbol/quantity conversion or HIP-3/spot routing.

1. `python -m unittest discover -s trader/tests -v` and `node --experimental-strip-types --experimental-transform-types src/lib/trade-auth.test.mjs`;
   also run `src/lib/trade-proxy.test.mjs` with those Node flags and `node scripts/trader-tools.test.mjs`.
2. `node scripts/trader-public-check.mjs` checks public **testnet metadata only**.
   It never signs or submits orders. Proxies may require Node's `--use-env-proxy`.
3. When credentials exist, manually validate testnet partial fills, stops, limits,
   fraction closes, cancellation and selected-venue close-all. No such orders are
   run by the automated tests or public probe.
4. Mainnet remains readonly for at least a day; compare balances/positions with
   each exchange. Only the owner enables `TRADING_ENABLED=true`, `TRADING_MODE=live`
   and changes the corresponding testnet flags to `false`. Start with a 20 USD
   order limit. Use separate database paths for testnet and mainnet.

## Risk And Recovery

Defaults (USD nominal, USDT/USDC treated 1:1): 500/order, 1000/asset across venues,
3000 total; 5x maximum leverage; 200 daily loss; 1% market IOC price bound;
10s same-asset/direction duplicate guard; 10 opening requests/minute. Override
via trader-only `TRADER_MAX_ORDER_NOTIONAL`, `TRADER_MAX_SYMBOL_NOTIONAL`,
`TRADER_MAX_TOTAL_NOTIONAL`, `TRADER_MAX_LEVERAGE`, `TRADER_MAX_DAILY_LOSS`,
`TRADER_SLIPPAGE_PCT`. Leverage/slippage cannot exceed 5x/1%.
Positions and pending opening orders on **both** accounts reserve exposure.
Status snapshots cache for 10s, invalidated on writes/day rollover; execution uses
fresh account data. Reductions/close-all do not depend on income-history reads.
Disconnected configured accounts block openings, not reductions on a healthy venue.
Reduce-only quantity always comes from current position times `closeFraction`.

Beijing midnight resets the day. Daily loss latches the worst of first-observed
equity drawdown and per-account realized losses (including fees/funding) plus
negative unrealized PnL; gains on another account/position never offset losses.
The baseline/latch survive restart. Withdrawals can conservatively trip the latch;
deposits cannot erase it. Midday startup uses full available daily realized history,
but cannot reconstruct unseen historical unrealized losses. Incomplete history
blocks openings. Use only supported USD collateral/fee currencies.

Every client ID is unique in SQLite. Repost the **identical** order with the same
ID to query/reconcile; never change IDs to retry uncertain execution. Unknown/not
found is not proof of rejection and is never automatically resubmitted. Preserve
the database/WAL and lock file across releases; do not delete them to unblock.
After an unresolved exchange timeout, reconcile manually with exchange history.
No automatic recovery converts an unknown intent into a new order.

Protection attaches only to confirmed filled quantity, including partial/delayed
limit fills. A 10s reconciliation poll and status reads drive updates (no SSE).
Receipts expose `warning`, `protectionError`, `protectionStatus`; status exposes
prominent protection errors, the last 100 journaled `fills`, and cancellation
events. A protection timeout is queried, **never resubmitted**, including after
restart. Failed/uncertain protection requires immediate exchange inspection;
there is no automatic emergency close, and stops do not guarantee fill prices.
SL/TP are independent reduce-only orders, not OCO; cancel stale siblings before
reopening a symbol. Close-all cancels current-venue orders, verifies cancellation,
attempts one bounded reduce-only close per current position, then checks again.
Partial/uncertain results require fresh position/order checks, never blind retry.

Unlock lasts 8h with HttpOnly/SameSite cookies, login binding, same-origin CSRF,
and five PIN attempts/15m globally. Lock revokes the current token; restarting the
single web worker invalidates all unlocks. PIN rotation invalidates old tokens.
Throttles are in-process and reset on web restart; do not expose multiple workers
without a shared throttle/revocation store. Rotate signing secrets to revoke all
sessions. Diagnostics are sanitized; do not enable SDK/HTTP debug logging.
