import { withWebPushApi } from '../../../../lib/web-push-api.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => withWebPushApi('getSubscriptionStatus', request);
export const POST = (request: Request) => withWebPushApi('subscribe', request);
export const DELETE = (request: Request) => withWebPushApi('unsubscribe', request);
