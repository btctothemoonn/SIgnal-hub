import { withWebPushApi } from '../../../../lib/web-push-api.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => withWebPushApi('testPush', request);
