// Public testnet metadata only. No env files, keys, signing, or order endpoints.
const probes = [
  ['Binance testnet time', 'https://demo-fapi.binance.com/fapi/v1/time', undefined, value => Number.isFinite(value.serverTime)],
  ['Binance testnet contracts', 'https://demo-fapi.binance.com/fapi/v1/exchangeInfo', undefined,
    value => value.symbols.some(s => s.symbol === 'BTCUSDT' && s.status === 'TRADING')],
  ['Hyperliquid testnet metadata', 'https://api.hyperliquid-testnet.xyz/info', { type: 'meta' },
    value => value.universe.some(s => s.name === 'BTC' && Number.isInteger(s.szDecimals))],
];
for (const [label, url, body, valid] of probes) {
  try {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'Content-Type': 'application/json' } : {}, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !valid(await response.json())) throw Error();
    console.log(`ok - ${label}`);
  } catch {
    console.error(`unavailable - ${label} (network, regional restriction, or metadata change)`);
    process.exitCode = 1;
  }
}
