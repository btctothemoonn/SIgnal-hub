import assert from "node:assert/strict";
import test from "node:test";
import {
  getBinanceHoldingSnapshot,
  resetBinanceHoldingRuntimeHints,
} from "./binance-holdings.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("a late Portfolio response cannot change the new account's futures mode", async () => {
  resetBinanceHoldingRuntimeHints();
  let started;
  let release;
  const ready = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const old = getBinanceHoldingSnapshot({
    env: { BINANCE_API_KEY: "old-portfolio-key", BINANCE_API_SECRET: "secret" },
    fetcher: async url => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/time")) return json({ serverTime: Date.now() });
      if (path === "/api/v3/account") return json({ balances: [] });
      if (path === "/api/v3/ticker/price") return json([]);
      if (path.startsWith("/fapi/")) return json({ msg: "not a standard account" }, 401);
      if (path === "/papi/v1/account") {
        started();
        await blocked;
        return json({ accountEquity: "1000", totalAvailableBalance: "1000" });
      }
      if (path === "/papi/v1/um/positionRisk") return json([]);
      throw new Error(`Unexpected old-account endpoint ${path}`);
    },
  });
  await ready;
  resetBinanceHoldingRuntimeHints();
  release();
  assert.equal((await old).accountMode, "portfolioMargin");
  const paths = [];
  try {
    const current = await getBinanceHoldingSnapshot({
      env: { BINANCE_API_KEY: "new-standard-key", BINANCE_API_SECRET: "secret" },
      fetcher: async url => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.endsWith("/time")) return json({ serverTime: Date.now() });
        if (path === "/api/v3/account") return json({ balances: [] });
        if (path === "/api/v3/ticker/price") return json([]);
        if (path === "/fapi/v3/account") return json({ totalMarginBalance: "100000", positions: [] });
        if (path === "/fapi/v3/positionRisk") return json([]);
        return json({ msg: "not a Portfolio account" }, 401);
      },
    });
    assert.ok(paths.includes("/fapi/v3/account"), "new credentials must probe their own account mode");
    assert.equal(current.accountMode, "standard");
    assert.equal(current.summary.futuresMarginBalance, 100000);
  } finally {
    resetBinanceHoldingRuntimeHints();
  }
});
