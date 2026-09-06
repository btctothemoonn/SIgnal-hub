import { handleWecomRead } from "@/lib/wecom-read-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleWecomRead(request, "ca-alerts"); }
