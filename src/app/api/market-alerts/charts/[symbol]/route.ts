import { readMarketAlertKlineChart } from "../../../../../lib/market-alerts-chart.ts";
import { openMarketAlertsStore } from "../../../../../lib/market-alerts-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";

function notFound() {
  return Response.json(
    { success: false, error: "Chart not found" },
    { status: 404, headers: { "Cache-Control": NO_STORE } },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const store = openMarketAlertsStore();
  let metadata;
  try {
    metadata = store.getMarketAlertChart(symbol);
    if (!metadata) return notFound();
    const requestedVersion = new URL(request.url).searchParams.get("v");
    if (requestedVersion && requestedVersion !== metadata.sourceKey) return notFound();
  } finally {
    store.close();
  }

  const chart = await readMarketAlertKlineChart(symbol, {
    sourceKey: metadata.sourceKey,
  });
  if (!chart) {
    const cleanupStore = openMarketAlertsStore();
    try {
      cleanupStore.deleteMarketAlertChart(symbol, metadata.sourceKey);
    } finally {
      cleanupStore.close();
    }
    return notFound();
  }
  return new Response(new Uint8Array(chart), {
    headers: {
      "Cache-Control": NO_STORE,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
