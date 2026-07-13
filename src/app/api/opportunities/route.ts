import { NextResponse, type NextRequest } from "next/server.js";
import {
  getOpportunityWorkerState,
  listOpportunities,
  openOpportunityDb,
} from "../../../lib/opportunity-store.ts";
import type {
  OpportunityListStatus,
  OpportunityMarketFilter,
  OpportunitySnapshot,
  OpportunitySort,
} from "../../../lib/opportunity-types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function parseOpportunityMarketFilter(value: string | null): OpportunityMarketFilter | null {
  if (value === null || value === "") return "all";
  if (value === "all" || value === "us" || value === "cn" || value === "crypto") return value;
  return null;
}

function parseOpportunitySort(value: string | null): OpportunitySort | null {
  if (value === null || value === "") return "score";
  if (value === "score" || value === "latest") return value;
  return null;
}

function parseOpportunityStatus(value: string | null): OpportunityListStatus | null {
  if (value === null || value === "") return "active";
  if (value === "active" || value === "history") return value;
  return null;
}

function parseOpportunityLimit(value: string | null): number {
  if (value === null) return 10;
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) && parsed !== 0 ? parsed : 10;
  return Math.min(100, Math.max(1, normalized));
}

function lastWorkerSuccessAt(value: string | null): string | null {
  if (!value) return null;
  try {
    const result = JSON.parse(value) as { lastSuccessAt?: unknown };
    return typeof result.lastSuccessAt === "string" ? result.lastSuccessAt : null;
  } catch {
    return null;
  }
}

export function getOpportunitySnapshot(options: {
  market: OpportunityMarketFilter;
  sort: OpportunitySort;
  status: OpportunityListStatus;
  limit: number;
}): OpportunitySnapshot {
  let db: ReturnType<typeof openOpportunityDb> | undefined;
  try {
    db = openOpportunityDb();
    return {
      generatedAt: new Date().toISOString(),
      lastWorkerSuccessAt: lastWorkerSuccessAt(getOpportunityWorkerState(db, "last_cycle")),
      market: options.market,
      sort: options.sort,
      status: options.status,
      items: listOpportunities(db, options),
      error: null,
    };
  } finally {
    db?.close();
  }
}

export async function GET(request: NextRequest) {
  const market = parseOpportunityMarketFilter(request.nextUrl.searchParams.get("market"));
  const sort = parseOpportunitySort(request.nextUrl.searchParams.get("sort"));
  const status = parseOpportunityStatus(request.nextUrl.searchParams.get("status"));
  const limit = parseOpportunityLimit(request.nextUrl.searchParams.get("limit"));

  if (market === null || sort === null || status === null) {
    return NextResponse.json(
      { error: "Invalid opportunity query", success: false },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    return NextResponse.json(
      getOpportunitySnapshot({ market, sort, status, limit }),
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to load opportunities", success: false },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
