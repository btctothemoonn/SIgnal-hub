export const PUSH_DEVICE_STORAGE_KEY = 'signal-hub:push-device:v1';
type Credentials = { deviceId: string; deviceKey: string; publicKey?: string; epoch?: number };
type BrowserSubscription = { options: { applicationServerKey?: ArrayBuffer | null }; toJSON(): PushSubscriptionJSON; unsubscribe(): Promise<boolean> };
type BrowserRegistration = { pushManager: { getSubscription(): Promise<BrowserSubscription | null>; subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<BrowserSubscription> } };
export type PushBrowser = { secureContext: boolean; userAgent: string; standalone: boolean; available: boolean; notification: { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> } | null; register(): Promise<BrowserRegistration>; crypto: Crypto; storage: Pick<Storage, 'getItem' | 'setItem'> };
export type PushClientStatus = { state: 'unsupported' | 'home_screen' | 'unconfigured' | 'denied' | 'ready' | 'enabled' | 'error'; enabled: boolean };
type PushApi = (path: string, options?: RequestInit) => Promise<Record<string, unknown>>;
function defaultBrowser(): PushBrowser | null {
  if (typeof window === 'undefined') return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  return { secureContext: window.isSecureContext, userAgent: nav.userAgent + (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1 ? ' iPad' : ''), standalone: nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches, available: 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window, notification: 'Notification' in window ? Notification : null,
    register: async () => { await nav.serviceWorker.register('/sw.js', { scope: '/' }); return await nav.serviceWorker.ready; }, crypto: window.crypto,
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) } };
}
export function getPushEnvironment(browser: PushBrowser | null = defaultBrowser()) {
  const needsHomeScreen = Boolean(browser && /iPhone|iPad|iPod/i.test(browser.userAgent) && !browser.standalone);
  return { supported: Boolean(browser?.secureContext && browser.available && browser.notification && !needsHomeScreen), needsHomeScreen, permission: browser?.notification?.permission ?? 'unsupported' as NotificationPermission | 'unsupported' };
}
function decodePublicKey(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function encodeBytes(value: ArrayBuffer | Uint8Array) { return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function getPushLogoutFields(browser: PushBrowser | null = defaultBrowser()) {
  try { const value = JSON.parse(browser?.storage.getItem(PUSH_DEVICE_STORAGE_KEY) ?? 'null') as Credentials | null; return value?.deviceId && value.deviceKey ? { pushDeviceId: value.deviceId, pushDeviceKey: value.deviceKey } : {}; } catch { return {}; }
}
export function createWebPushClient(api: PushApi = async (path, options) => {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options });
  const result = await response.json(); if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'push_request_failed'); return result;
}, browser: PushBrowser | null = defaultBrowser()) {
  let config: { enabled: boolean; configured: boolean; publicKey: string | null } | null = null;
  let registration: BrowserRegistration | null = null;
  const load = (): Credentials | null => { try { return JSON.parse(browser?.storage.getItem(PUSH_DEVICE_STORAGE_KEY) ?? 'null'); } catch { return null; } };
  const save = (credentials: Credentials) => { if (!browser) throw new Error('push_unsupported'); browser.storage.setItem(PUSH_DEVICE_STORAGE_KEY, JSON.stringify(credentials)); if (typeof window !== 'undefined') window.dispatchEvent(new Event('signal-push-device-change')); };
  const headers = () => { const credentials = load(); return { 'X-Signal-Push-Device': credentials?.deviceId ?? '', 'X-Signal-Push-Device-Key': credentials?.deviceKey ?? '' }; };
  async function subscriptionMatches() { const existing = await registration?.pushManager.getSubscription(); if (!existing) return false; const key = existing.options.applicationServerKey; return key ? encodeBytes(key) === config?.publicKey : load()?.publicKey === config?.publicKey; }
  const client = {
    async readStatus(): Promise<PushClientStatus> {
      const environment = getPushEnvironment(browser);
      if (environment.needsHomeScreen) return { state: 'home_screen', enabled: false };
      if (!environment.supported) return { state: 'unsupported', enabled: false };
      try {
        config = await api('/api/push/config') as typeof config;
        if (!config?.enabled || !config.configured || !config.publicKey) return { state: 'unconfigured', enabled: false };
        registration = await browser!.register();
        let enabled = false;
        if (load()) {
          try { enabled = (await api('/api/push/subscriptions', { headers: headers() })).enabled === true; }
          catch (error) { if (!(error instanceof Error) || error.message !== 'device_proof_required') throw error; }
        }
        if (browser!.notification!.permission === 'denied') return { state: 'denied', enabled };
        return { state: enabled && browser!.notification!.permission === 'granted' && await subscriptionMatches() ? 'enabled' : 'ready', enabled };
      } catch { return { state: 'error', enabled: false }; }
    },
    enableFromUserGesture(): Promise<PushClientStatus> {
      if (!browser?.notification || !registration || !config?.publicKey || !getPushEnvironment(browser).supported) return Promise.reject(new Error('push_not_ready'));
      // Keep this call synchronous in the click handler, before subscription/network awaits (iOS).
      const permission = browser.notification.permission === 'granted' ? Promise.resolve('granted' as const) : browser.notification.requestPermission();
      return (async () => {
        if (await permission !== 'granted') return { state: 'denied', enabled: false };
        let credentials = load();
        if (!credentials?.deviceId || !credentials.deviceKey) { const bytes = browser.crypto.getRandomValues(new Uint8Array(32)); credentials = { deviceId: browser.crypto.randomUUID(), deviceKey: encodeBytes(bytes) }; save(credentials); }
        let existing = await registration!.pushManager.getSubscription();
        if (existing && !await subscriptionMatches()) { await existing.unsubscribe(); existing = null; }
        const subscription = existing ?? await registration!.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePublicKey(config!.publicKey!) });
        const response = await api('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: credentials.deviceId, deviceKey: credentials.deviceKey, subscription: subscription.toJSON() }) });
        save({ ...credentials, publicKey: config!.publicKey!, epoch: response.epoch as number });
        const verified = await client.readStatus(); if (verified.state !== 'enabled') throw new Error('enrollment_unconfirmed'); return verified;
      })();
    },
    async disable(): Promise<PushClientStatus> {
      const credentials = load(); if (!credentials) throw new Error('device_proof_required');
      await api('/api/push/subscriptions', { method: 'DELETE', headers: headers() });
      const existing = await registration?.pushManager.getSubscription(); if (existing) await existing.unsubscribe();
      save(credentials); return { state: 'ready', enabled: false };
    },
    async sendTest() { return await api('/api/push/test', { method: 'POST', headers: headers() }); },
    getLogoutFields: () => getPushLogoutFields(browser),
  };
  return client;
}
export type WebPushClient = ReturnType<typeof createWebPushClient>;
