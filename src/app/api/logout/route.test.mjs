import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const routeSource = await readFile(resolve("src/app/api/logout/route.ts"), "utf8");
const shellSource = await readFile(resolve("src/components/app-shell.tsx"), "utf8");

assert.match(routeSource, /export async function GET\(\)/);
assert.match(routeSource, /export async function POST\(request: Request\)/);
assert.match(routeSource, /Use POST to sign out\./);
assert.match(shellSource, /<form action="\/api\/logout" method="post"/);
assert.doesNotMatch(shellSource, /href="\/api\/logout"/);

console.log("ok - logout uses POST form");
const { registerHooks } = await import('node:module');
const { pathToFileURL } = await import('node:url');
const order = []; globalThis.__logoutOrder = order; globalThis.__logoutDenied = null;
const modules = {
 'next/headers': 'export async function cookies(){return {set(){globalThis.__logoutOrder.push("cookie");}}}',
 'next/server': 'export const NextResponse={json:Response.json,redirect(url,init){return new Response(null,{...init,headers:{...init.headers,Location:String(url)}})}};',
};
const hooks = registerHooks({ resolve(specifier, context, next) {
 if (specifier.endsWith('/web-push-api.ts')) return { url: 'data:text/javascript,' + encodeURIComponent('export function getPushRequestOrigin(request){return new URL(request.url).origin;} export async function revokePushForLogout(){globalThis.__logoutOrder.push("revoke");return globalThis.__logoutDenied;}'), shortCircuit: true };
 if (modules[specifier]) return { url: 'data:text/javascript,' + encodeURIComponent(modules[specifier]), shortCircuit: true };
 if (specifier === '@/lib/admin-auth') return { url: pathToFileURL(resolve('src/lib/admin-auth.ts')).href, shortCircuit: true };
 return next(specifier, context);
} });
try {
 const { POST } = await import('./route.ts');
 const response = await POST(new Request('https://hub.example.com/api/logout', { method: 'POST' }));
 assert.equal(response.status, 303); assert.deepEqual(order, ['revoke', 'cookie']);
 order.length = 0; globalThis.__logoutDenied = new Response(null, { status: 403 });
 assert.equal((await POST(new Request('https://hub.example.com/api/logout', { method: 'POST' }))).status, 403);
 assert.deepEqual(order, ['revoke']);
} finally { hooks.deregister(); delete globalThis.__logoutOrder; delete globalThis.__logoutDenied; }
