import { handleTrade } from '../../../../lib/trade-proxy.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return handleTrade(request, 'cancel'); }
