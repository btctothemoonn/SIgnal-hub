import { handleTrade } from '../../../../lib/trade-proxy.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleTrade(request, 'status'); }
