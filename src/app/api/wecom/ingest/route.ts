import { forwardWecomIngest } from "@/lib/wecom-receiver";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return forwardWecomIngest(request); }
