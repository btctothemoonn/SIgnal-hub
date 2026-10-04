import { test, expect } from '@playwright/test';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWebPushStore } from '../src/lib/web-push-store.ts';
import { createWebPushApiHandlers, revokePushForLogout } from '../src/lib/web-push-api.ts';
import { DatabaseSync } from 'node:sqlite';
import { createImportantNewsPushStore } from '../src/lib/important-news-push.ts';
import type { DailyBriefSnapshot } from '../src/lib/daily-investment-brief.ts';

test('full local storage recovers device proof and preserves enrollment across reload and logout', async ({ page, context, baseURL }) => {
  const runtime = mkdtempSync(join(tmpdir(), 'push-browser-quota-'));
  const store = openWebPushStore(join(runtime, 'web-push.sqlite'));
  const ec = createECDH('prime256v1'); ec.generateKeys();
  const publicKey = ec.getPublicKey().toString('base64url');
  const auth = randomBytes(16).toString('base64url');
  const env = { NODE_ENV: 'test', ADMIN_PASSWORD: process.env.SIGNAL_E2E_PASSWORD, ADMIN_SESSION_SECRET: process.env.SIGNAL_E2E_SESSION_SECRET, WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: ec.getPrivateKey().toString('base64url'), WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com', SIGNAL_HUB_PUBLIC_ORIGIN: baseURL };
  const sent: string[] = [];
  const handlers = createWebPushApiHandlers({ store, env, sender: { send: async (_, event) => { sent.push(event.title); return { kind: 'accepted', statusCode: 201, retryAfterMs: null, errorCode: null }; } }, baselineProvider: nowMs => ({ sources: { market: 0, news: 0 }, marketEpisodes: [], enabledAt: new Date(nowMs).toISOString() }) });
  try {
    await context.grantPermissions(['notifications'], { origin: baseURL! });
    await context.addInitScript(({ publicKey, auth }) => {
      const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)).buffer;
      const subscription = () => ({ endpoint: 'https://fcm.googleapis.com/quota-e2e', options: { applicationServerKey: decode(publicKey) }, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/quota-e2e', expirationTime: null, keys: { p256dh: publicKey, auth } }), unsubscribe: async () => { localStorage.removeItem('signal:mock-push'); return true; } });
      PushManager.prototype.subscribe = async () => { localStorage.setItem('signal:mock-push', 'yes'); return subscription() as unknown as PushSubscription; };
      PushManager.prototype.getSubscription = async () => localStorage.getItem('signal:mock-push') ? subscription() as unknown as PushSubscription : null;
    }, { publicKey, auth });
    await context.route('**/api/push/**', async route => {
      const request = route.request(); const method = request.method(); const path = new URL(request.url()).pathname;
      const handler = path.endsWith('/config') ? handlers.config : path.endsWith('/test') ? handlers.testPush : method === 'POST' ? handlers.subscribe : method === 'DELETE' ? handlers.unsubscribe : handlers.getSubscriptionStatus;
      const response = await handler(new Request(request.url(), { method, headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData() } : {}) }));
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await context.route('**/api/logout', async route => {
      const request = route.request();
      const rejection = await revokePushForLogout(new Request(request.url(), { method: 'POST', headers: await request.allHeaders(), body: request.postData() }), { env, store });
      if (rejection) await route.fulfill({ status: rejection.status, body: await rejection.text() }); else await route.continue();
    });
    await page.goto('/login?next=/settings');
    await page.getByLabel('Admin password').fill(process.env.SIGNAL_E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/settings');
    await page.getByRole('button', { name: '重要通知', exact: true }).click();
    await expect(page.getByRole('button', { name: '开启通知', exact: true })).toBeVisible();
    const full = await page.evaluate(() => {
      const cache = 'signal-hub:stocks:hynix-premium:v4:1h';
      const smallerCache = 'signal-hub:stocks:market-snapshot:v1';
      const preserved = { 'signal-hub:theme:cromojo-dark-dashboard:v1': 'dark', 'signal-hub:stocks:hynix-premium:selected-interval:v1': JSON.stringify('1h'), 'signal-hub:signal-feed-author-favorites': JSON.stringify(['telegram:kept']), 'signal-hub:signal-feed-reading-anchor': JSON.stringify({ itemId: 'kept', viewportTop: 30, savedAt: '2026-10-04T08:00:00Z' }) };
      for (const [key, value] of Object.entries(preserved)) localStorage.setItem(key, value);
      localStorage.setItem(cache, 'x'.repeat(3 * 1024 * 1024));
      localStorage.setItem(smallerCache, 'y'.repeat(128 * 1024));
      let low = 0, high = 4 * 1024 * 1024;
      while (low < high) {
        const size = Math.ceil((low + high) / 2);
        try { localStorage.setItem('unrelated:retained-data', 'z'.repeat(size)); low = size; }
        catch (error) { if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error; high = size - 1; }
      }
      let errorName = '';
      try { localStorage.setItem('quota-proof-probe', 'p'.repeat(256)); localStorage.removeItem('quota-proof-probe'); }
      catch (error) { errorName = (error as DOMException).name; }
      return { errorName, cache, smallerCache, preserved, retainedLength: low };
    });
    expect(full.errorName, 'the fixture must exhaust real browser storage before enrollment').toBe('QuotaExceededError');
    expect(full.retainedLength).toBeGreaterThan(0);
    await page.getByRole('button', { name: '开启通知', exact: true }).click();
    await expect(page.getByText('通知已开启', { exact: true })).toBeVisible();
    const state = await page.evaluate(({ cache, smallerCache, preserved }) => ({ proof: JSON.parse(localStorage.getItem('signal-hub:push-device:v1')!), largest: localStorage.getItem(cache), smallerLength: localStorage.getItem(smallerCache)?.length, retainedLength: localStorage.getItem('unrelated:retained-data')?.length, preserved: Object.fromEntries(Object.keys(preserved).map(key => [key, localStorage.getItem(key)])) }), full);
    expect(state.largest).toBeNull();
    expect(state.smallerLength).toBe(128 * 1024);
    expect(state.retainedLength).toBe(full.retainedLength);
    expect(state.preserved).toEqual(full.preserved);
    expect(store.getDeviceStatus(state.proof.deviceId, state.proof.deviceKey)?.enabled).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: '重要通知', exact: true }).click();
    await expect(page.getByText('通知已开启', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('signal-hub:push-device:v1')!))).toEqual(state.proof);
    await page.getByRole('button', { name: '发送测试通知', exact: true }).click();
    await expect(page.getByText('测试通知已提交，请确认当前设备能看到提醒。', { exact: true })).toBeVisible();
    expect(sent).toEqual(['Signal Hub 测试通知']);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL('**/login');
    expect(store.getDeviceStatus(state.proof.deviceId, state.proof.deviceKey)?.enabled).toBe(false);
  } finally {
    await context.unrouteAll({ behavior: 'wait' }); store.close();
    expect(runtime.startsWith(join(tmpdir(), 'push-browser-quota-'))).toBe(true);
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('current-device enrollment, test, revoke, logout and closed-page service worker', async ({ page, context, baseURL }) => {
  const runtime = mkdtempSync(join(tmpdir(), 'push-browser-'));
  const store = openWebPushStore(join(runtime, 'web-push.sqlite'));
  const ec = createECDH('prime256v1'); ec.generateKeys();
  const publicKey = ec.getPublicKey().toString('base64url');
  const auth = randomBytes(16).toString('base64url');
  const env = { NODE_ENV: 'test', ADMIN_PASSWORD: process.env.SIGNAL_E2E_PASSWORD, ADMIN_SESSION_SECRET: process.env.SIGNAL_E2E_SESSION_SECRET, WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: ec.getPrivateKey().toString('base64url'), WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com', SIGNAL_HUB_PUBLIC_ORIGIN: baseURL };
  const sent: string[] = [];
  const handlers = createWebPushApiHandlers({ store, env, sender: { send: async (_, event) => { sent.push(event.title); return { kind: 'accepted', statusCode: 201, retryAfterMs: null, errorCode: null }; } }, baselineProvider: nowMs => ({ sources: { market: 0, news: 0 }, marketEpisodes: [], enabledAt: new Date(nowMs).toISOString() }) });
  try {
    await context.grantPermissions(['notifications'], { origin: baseURL! });
    await context.addInitScript(({ publicKey, auth }) => {
      const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)).buffer;
      const subscription = () => ({ endpoint: 'https://fcm.googleapis.com/push-e2e', options: { applicationServerKey: decode(publicKey) }, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/push-e2e', expirationTime: null, keys: { p256dh: publicKey, auth } }), unsubscribe: async () => { localStorage.removeItem('signal:mock-push'); return true; } });
      PushManager.prototype.subscribe = async function () { localStorage.setItem('signal:mock-push', 'yes'); return subscription() as unknown as PushSubscription; };
      PushManager.prototype.getSubscription = async function () { return localStorage.getItem('signal:mock-push') ? subscription() as unknown as PushSubscription : null; };
    }, { publicKey, auth });
    await context.route('**/api/push/**', async route => {
      const request = route.request(); const method = request.method(); const path = new URL(request.url()).pathname;
      const handler = path.endsWith('/config') ? handlers.config : path.endsWith('/test') ? handlers.testPush : method === 'POST' ? handlers.subscribe : method === 'DELETE' ? handlers.unsubscribe : handlers.getSubscriptionStatus;
      const response = await handler(new Request(request.url(), { method, headers: await request.allHeaders(), ...(request.postData() ? { body: request.postData() } : {}) }));
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await context.route('**/api/logout', async route => {
      const request = route.request();
      const rejection = await revokePushForLogout(new Request(request.url(), { method: 'POST', headers: await request.allHeaders(), body: request.postData() }), { env, store });
      if (rejection) await route.fulfill({ status: rejection.status, body: await rejection.text() }); else await route.continue();
    });
    const login = async () => { await page.goto('/login?next=/settings'); await page.getByLabel('Admin password').fill(process.env.SIGNAL_E2E_PASSWORD!); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/settings'); await page.getByRole('button', { name: '重要通知', exact: true }).click(); };
    await login();
    await page.getByRole('button', { name: '开启通知', exact: true }).click();
    await expect(page.getByText('通知已开启', { exact: true })).toBeVisible();
    const proof = await page.evaluate(() => JSON.parse(localStorage.getItem('signal-hub:push-device:v1')!));
    expect(store.getDeviceStatus(proof.deviceId, proof.deviceKey)?.epoch).toBe(1);
    await page.getByRole('button', { name: '发送测试通知', exact: true }).click();
    await expect(page.getByText('测试通知已提交，请确认当前设备能看到提醒。', { exact: true })).toBeVisible();
    expect(sent).toEqual(['Signal Hub 测试通知']);
    await page.getByRole('button', { name: '关闭通知', exact: true }).click();
    await expect(page.getByRole('button', { name: '开启通知', exact: true })).toBeVisible();
    expect(store.getDeviceStatus(proof.deviceId, proof.deviceKey)?.enabled).toBe(false);
    await page.getByRole('button', { name: '开启通知', exact: true }).click();
    await expect(page.getByText('通知已开启', { exact: true })).toBeVisible();
    expect(store.getDeviceStatus(proof.deviceId, proof.deviceKey)?.epoch).toBe(3);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL('**/login');
    expect(store.getDeviceStatus(proof.deviceId, proof.deviceKey)?.enabled).toBe(false);
    await login(); await expect(page.getByRole('button', { name: '开启通知', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '开启通知', exact: true }).click(); await expect(page.getByText('通知已开启', { exact: true })).toBeVisible();
    const control = await context.newPage(); const cdp = await context.newCDPSession(control);
    const registrations = new Map<string, { registrationId: string; scopeURL: string; isDeleted: boolean }>();
    const active = new Set<string>();
    cdp.on('ServiceWorker.workerRegistrationUpdated', data => { for (const registration of data.registrations) registrations.set(registration.registrationId, registration); });
    cdp.on('ServiceWorker.workerVersionUpdated', data => { for (const version of data.versions) if (version.status === 'activated') active.add(version.registrationId); });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => [...registrations.values()].find(row => row.scopeURL === `${baseURL}/` && !row.isDeleted && active.has(row.registrationId))?.registrationId).toBeTruthy();
    const registrationId = [...registrations.values()].find(row => row.scopeURL === `${baseURL}/` && !row.isDeleted && active.has(row.registrationId))!.registrationId;
    for (const current of context.pages()) if (current !== control) await current.close();
    const payload = { title: '关闭页面后模拟重要异动', body: '本地 Service Worker 验收', episodeId: 'closed-page-test', target: '/alerts?symbol=BTCUSDT#market-push-BTCUSDT' };
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: baseURL!, registrationId, data: JSON.stringify(payload) });
    const reopened = await context.newPage(); await reopened.goto('/settings');
    const notifications = () => reopened.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(notification => ({ title: notification.title, tag: notification.tag, target: notification.data?.target })));
    await expect.poll(notifications).toContainEqual({ title: payload.title, tag: 'signal-hub:closed-page-test', target: `${baseURL}${payload.target}` });
    await reopened.evaluate(async () => { for (const notification of await (await navigator.serviceWorker.ready).getNotifications()) notification.close(); });
    await cdp.detach();
  } finally { await context.unrouteAll({ behavior: 'wait' }); store.close(); rmSync(runtime, { recursive: true, force: true }); }
});

test('browser subscription failure displays its safe setup stage', async ({ page, context, baseURL }) => {
  const ec = createECDH('prime256v1'); ec.generateKeys();
  const publicKey = ec.getPublicKey().toString('base64url');
  await context.grantPermissions(['notifications'], { origin: baseURL! });
  await context.addInitScript(() => {
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = async () => {
      throw new DOMException('Private provider detail https://secret.invalid/device-key', 'AbortError');
    };
  });
  await context.route('**/api/push/config', route => route.fulfill({ json: { enabled: true, configured: true, publicKey } }));
  await page.goto('/login?next=/settings');
  await page.getByLabel('Admin password').fill(process.env.SIGNAL_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/settings');
  await page.getByRole('button', { name: '重要通知', exact: true }).click();
  await page.getByRole('button', { name: '开启通知', exact: true }).click();
  const diagnostic = page.getByRole('status').filter({ hasText: 'AbortError' });
  await expect(diagnostic).toBeVisible();
  await expect(diagnostic).toContainText('browser_subscription');
  await expect(page.getByText('通知已开启', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/secret\.invalid|device-key/)).toHaveCount(0);
});

test('news links open their preserved edition and select crypto or markets', async ({ page }) => {
  const at = new Date().toISOString();
  const dateKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const snapshot: DailyBriefSnapshot = { success: true, status: 'generated', configured: true,
    period: { key: dateKey, dateKey, label: '通知对应的历史简报', startAt: at, endAt: at, timeZone: 'Asia/Shanghai' },
    generatedAt: at, model: 'local-test', candidateCount: 2, sourceCounts: { Reuters: 2 }, error: null,
    brief: { title: '保存的通知简报', marketPulse: '', priorityLine: '', watchVariables: [],
      items: ['BTC / 加密货币', '宏观 / 地缘政治 / 原油'].map((topic, index) => ({
        rank: index + 1, importance: 'high', title: `本地重要新闻定位 ${index}`, topic,
        sourceNames: ['Reuters'], sourceUrls: [], imageUrl: null, whatHappened: '本地事实', investmentImpact: '本地影响', watchNext: '实施',
        pushAssessedAt: at, pushAssessment: { exceptional: true, category: '已公布的重大政策决定', fact: '正式政策', impact: '重要影响', candidateIndexes: [index + 1] },
        validatedSources: [{ sourceId: `browser-${index}`, canonicalUrl: `https://www.reuters.com/world/browser-${index}`, source: 'Reuters', publishedAt: at, timeBasis: 'publication' }],
      })) } };
  const db = new DatabaseSync(process.env.DAILY_BRIEF_DB!);
  let targets: string[];
  try { targets = createImportantNewsPushStore(db).appendGeneratedBrief(snapshot, Date.parse(at)).events.map(event => event.target); } finally { db.close(); }
  expect(targets!).toHaveLength(2);
  await page.goto('/login?next=/intel');
  await page.getByLabel('Admin password').fill(process.env.SIGNAL_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/intel');
  await expect(page.getByText('保存的通知简报', { exact: true })).toHaveCount(0);
  for (const [index, target] of targets!.entries()) {
    await page.goto(target);
    await expect(page.getByText('保存的通知简报', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: index === 0 ? /币圈/ : /宏观市场/ })).toHaveAttribute('aria-selected', 'true');
    const card = page.locator('article').filter({ hasText: `本地重要新闻定位 ${index}` });
    await expect(card).toBeInViewport();
    await expect(card).toHaveAttribute('id', /^news-push-news:/);
  }
});
