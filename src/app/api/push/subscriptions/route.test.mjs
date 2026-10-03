import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const calls = [];
globalThis.__pushRouteCalls = calls;
const stub = "export async function withWebPushApi(method,request){globalThis.__pushRouteCalls.push({method,request});return Response.json({method});}";
const hooks = registerHooks({resolve(specifier,context,next){if(specifier.endsWith('/web-push-api.ts')) return {url:'data:text/javascript,'+encodeURIComponent(stub),shortCircuit:true};return next(specifier,context);}});
try {
 const route = await import('./route.ts');
 assert.equal(route.runtime, 'nodejs'); assert.equal(route.dynamic, 'force-dynamic');
 for (const [method, handler] of Object.entries({"GET":"getSubscriptionStatus","POST":"subscribe","DELETE":"unsubscribe"})) { const request = new Request('https://hub.example.com/api/push/subscriptions',{method}); const response = await route[method](request); assert.equal((await response.json()).method,handler); assert.equal(calls.at(-1).request,request); }
} finally { hooks.deregister(); delete globalThis.__pushRouteCalls; }
console.log('push subscriptions route wiring passed');
