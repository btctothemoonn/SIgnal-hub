import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const calls = [];
globalThis.__pushRouteCalls = calls;
const stub = "export async function withWebPushApi(method,request){globalThis.__pushRouteCalls.push({method,request});return Response.json({method});}";
const hooks = registerHooks({resolve(specifier,context,next){if(specifier.endsWith('/web-push-api.ts')) return {url:'data:text/javascript,'+encodeURIComponent(stub),shortCircuit:true};return next(specifier,context);}});
try {
 const route = await import('./route.ts');
 assert.equal(route.runtime, 'nodejs'); assert.equal(route.dynamic, 'force-dynamic');
 const request = new Request('https://hub.example.com/api/push/diagnostics');
 const response = await route.GET(request);
 assert.equal((await response.json()).method, 'diagnostics');
 assert.equal(calls.at(-1).request, request);
} finally { hooks.deregister(); delete globalThis.__pushRouteCalls; }
console.log('push diagnostics route wiring passed');
