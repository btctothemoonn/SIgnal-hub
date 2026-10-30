import { readAiUsageSummary } from "../../../lib/ai-usage.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(readAiUsageSummary(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
