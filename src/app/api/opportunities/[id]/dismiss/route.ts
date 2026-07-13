import { NextResponse } from "next/server.js";
import { openOpportunityDb, setOpportunityPreference } from "../../../../../lib/opportunity-store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function parseClusterId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const clusterId = Number(value);
  return Number.isSafeInteger(clusterId) && clusterId > 0 ? clusterId : null;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const clusterId = parseClusterId(id);
  if (clusterId === null) {
    return NextResponse.json(
      { error: "Invalid opportunity id", success: false },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let db: ReturnType<typeof openOpportunityDb> | undefined;
  try {
    db = openOpportunityDb();
    const cluster = db.prepare("SELECT 1 FROM opportunity_clusters WHERE id = ?").get(clusterId);
    if (!cluster) {
      return NextResponse.json(
        { error: "Opportunity not found", success: false },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    setOpportunityPreference(db, clusterId, { dismissed: true });
    return NextResponse.json(
      { success: true, id: clusterId, dismissed: true },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to update preference", success: false },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    db?.close();
  }
}
