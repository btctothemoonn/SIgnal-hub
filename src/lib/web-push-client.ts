export const PUSH_DEVICE_STORAGE_KEY = 'signal-hub:push-device:v1';
type Credentials = { deviceId: string; deviceKey: string; publicKey?: string; epoch?: number };
type BrowserSubscription = { options: { applicationServerKey?: ArrayBuffer | null }; toJSON(): PushSubscriptionJSON; unsubscribe(): Promise<boolean> };
type BrowserRegistration = { pushManager: { getSubscription(): Promise<BrowserSubscription | null>; subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<BrowserSubscription> } };
export type PushBrowser = { secureContext: boolean; userAgent: string; standalone: boolean; available: boolean; notification: { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> } | null; register(): Promise<BrowserRegistration>; crypto: Crypto; storage: Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'length' | 'key' | 'removeItem'>> };
export type PushClientStatus = { state: 'unsupported' | 'home_screen' | 'unconfigured' | 'denied' | 'ready' | 'enabled' | 'error'; enabled: boolean };
type PushEnrollmentStage = 'permission' | 'device_storage' | 'browser_subscription' | 'server_registration' | 'confirmation';
const pushErrorMessages = {
  same_origin_required: '通知注册被同源检查拒绝，请核对当前网址与正式网站网址是否一致，并从正式网址重新开启通知。',
  login_required: '登录状态已失效，请重新登录后再操作通知。',
  control_rate_limited: '通知操作过于频繁，请稍后再试。',
  device_proof_required: '当前设备登记无法确认，请刷新状态后重新开启通知。',
  device_conflict: '当前设备登记发生冲突，请刷新状态后重试。',
  push_not_ready: '通知准备尚未完成，请刷新状态后再开启通知。',
  push_unsupported: '当前环境无法使用通知，请检查浏览器支持情况和安全网址。',
  push_not_configured: '通知服务配置尚未就绪，请联系管理员检查服务配置。',
  invalid_request: '服务器未接受通知登记数据，请刷新状态后重试；仍失败时请联系管理员。',
  invalid_device: '服务器未接受当前设备的通知凭证，请记录错误码和阶段供管理员检查。',
  body_too_large: '通知登记数据超出限制，请联系管理员检查。',
  json_required: '通知登记请求格式未被接受，请刷新页面后重试。',
  push_control_failed: '服务器未能完成通知操作，请稍后重试；仍失败时请联系管理员。',
  enrollment_unconfirmed: '通知登记后的状态未确认，请刷新状态，并记录错误码和阶段。',
  push_request_failed: '通知操作未完成，请检查网络，刷新状态，并记录错误码和阶段。',
  push_gone: '推送订阅已失效，请刷新状态后重新开启通知。',
  push_auth_failed: '推送服务认证失败，请联系管理员检查服务密钥。',
  push_rejected: '推送服务拒绝了测试通知，请联系管理员检查。',
  push_rate_limited: '推送服务暂时限流，请稍后重试。',
  push_temporarily_unavailable: '推送服务暂时不可用，请检查网络或稍后重试。',
  event_expired: '测试通知已过期，请在设备联网时重新发送。',
  test_not_accepted: '测试通知未被推送服务接受，请稍后重试。',
  NotAllowedError: '浏览器未允许通知操作，请检查本站通知权限；iPhone 请从主屏幕图标打开。',
  AbortError: '浏览器中止了通知操作，请检查网络，保持页面打开后手动重试。',
  NotSupportedError: '浏览器不支持此通知操作，请检查浏览器版本；iPhone 请从主屏幕图标打开。',
  InvalidStateError: '浏览器通知状态暂不可用，请刷新页面并重新检查通知状态。',
  SecurityError: '浏览器安全检查拒绝了通知操作，请核对正式网站网址和安全连接。',
  QuotaExceededError: '当前设备无法保存通知登记，请检查浏览器存储是否可用。',
  NetworkError: '浏览器通知操作遇到网络错误，请检查网络后手动重试。',
  TimeoutError: '浏览器通知操作超时，请检查网络后手动重试。',
  DataError: '浏览器未接受通知订阅数据，请刷新状态；仍失败时请联系管理员。',
  InvalidAccessError: '浏览器未接受通知订阅参数，请联系管理员检查。',
  OperationError: '浏览器未能完成通知订阅，请记录错误码和阶段供管理员检查。',
} as const;
type PushErrorCode = keyof typeof pushErrorMessages;
const pushDomExceptionNames = new Set(['NotAllowedError', 'AbortError', 'NotSupportedError', 'InvalidStateError', 'SecurityError', 'QuotaExceededError', 'NetworkError', 'TimeoutError', 'DataError', 'InvalidAccessError', 'OperationError']);
function safePushErrorCode(error: unknown): PushErrorCode {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return pushDomExceptionNames.has(error.name) ? error.name as PushErrorCode : 'push_request_failed';
  }
  return error instanceof Error && Object.prototype.hasOwnProperty.call(pushErrorMessages, error.message) ? error.message as PushErrorCode : 'push_request_failed';
}
class PushEnrollmentError extends Error {
  readonly code: PushErrorCode;
  readonly stage: PushEnrollmentStage;
  constructor(error: unknown, stage: PushEnrollmentStage) {
    const code = safePushErrorCode(error);
    super(code);
    this.name = 'PushEnrollmentError';
    this.code = code;
    this.stage = stage;
  }
}
export function getPushErrorMessage(error: unknown): string {
  const code = safePushErrorCode(error);
  const stage = error instanceof PushEnrollmentError ? error.stage : 'unknown';
  return `${pushErrorMessages[code]}（${code}；阶段：${stage}）`;
}

type PushApi = (path: string, options?: RequestInit) => Promise<Record<string, unknown>>;
function defaultBrowser(): PushBrowser | null {
  if (typeof window === 'undefined') return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  return { secureContext: window.isSecureContext, userAgent: nav.userAgent + (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1 ? ' iPad' : ''), standalone: nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches, available: 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window, notification: 'Notification' in window ? Notification : null,
    register: async () => { await nav.serviceWorker.register('/sw.js', { scope: '/' }); return await nav.serviceWorker.ready; }, crypto: window.crypto,
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value),
      get length() { return window.localStorage.length; }, key: index => window.localStorage.key(index), removeItem: key => window.localStorage.removeItem(key) } };
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
const rebuildablePushCacheKeys = new Set([
  'signal-hub:stocks:hynix-premium:5m:v1',
  'signal-hub:stocks:hynix-premium:5m:v2',
  'signal-hub:stocks:hynix-premium:v3:5m',
  'signal-hub:stocks:hynix-premium:v3:1h',
  'signal-hub:stocks:hynix-premium:v3:1d',
  'signal-hub:stocks:hynix-funding:v1',
  'signal-hub:stocks:market-snapshot:v1',
  'signal-hub:stocks:financial-snapshot:v1',
  'signal-hub.binance-holding-snapshot.v1',
  'signal-hub.tiger-holding-snapshot.v1',
  'signal-hub.tiger-equity-history.v1',
]);
function isRebuildablePushCache(key: string): boolean {
  if (rebuildablePushCacheKeys.has(key) || /^signal-hub:stocks:hynix-premium:v4:(1m|5m|1h|1d)$/.test(key)) return true;
  const prefix = 'signal-hub:stocks:performance-snapshot:v1:';
  if (!key.startsWith(prefix)) return false;
  const tickers = key.slice(prefix.length);
  try { return tickers.length > 0 && encodeURIComponent(decodeURIComponent(tickers)) === tickers; } catch { return false; }
}
function persistPushDevice(storage: PushBrowser['storage'], value: string, allowCacheRecovery: boolean): boolean {
  try { storage.setItem(PUSH_DEVICE_STORAGE_KEY, value); return false; }
  catch (error) {
    if (!allowCacheRecovery || typeof DOMException === 'undefined' || !(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
    // Reclaim one server-rebuildable snapshot; a failed retry must stay a storage failure.
    try {
      const length = storage.length;
      if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || !storage.key || !storage.removeItem) throw error;
      let largestKey: string | null = null, largestLength = -1;
      for (let index = 0; index < length; index++) {
        const key = storage.key(index);
        if (!key || !isRebuildablePushCache(key)) continue;
        const cached = storage.getItem(key);
        if (cached !== null && cached.length > largestLength) { largestKey = key; largestLength = cached.length; }
      }
      if (!largestKey) throw error;
      storage.removeItem(largestKey);
    } catch { throw error; }
    storage.setItem(PUSH_DEVICE_STORAGE_KEY, value);
    return true;
  }
}
export function createWebPushClient(api: PushApi = async (path, options) => {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options });
  const result = await response.json(); if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'push_request_failed'); return result;
}, browser: PushBrowser | null = defaultBrowser()) {
  let config: { enabled: boolean; configured: boolean; publicKey: string | null } | null = null;
  let registration: BrowserRegistration | null = null;
  const load = (): Credentials | null => { try { return JSON.parse(browser?.storage.getItem(PUSH_DEVICE_STORAGE_KEY) ?? 'null'); } catch { return null; } };
  const save = (credentials: Credentials, allowCacheRecovery = false) => { if (!browser) throw new Error('push_unsupported'); const recovered = persistPushDevice(browser.storage, JSON.stringify(credentials), allowCacheRecovery); if (typeof window !== 'undefined') window.dispatchEvent(new Event('signal-push-device-change')); return recovered; };
  const headers = () => { const credentials = load(); return { 'X-Signal-Push-Device': credentials?.deviceId ?? '', 'X-Signal-Push-Device-Key': credentials?.deviceKey ?? '' }; };
  async function subscriptionMatches() { const existing = await registration?.pushManager.getSubscription(); if (!existing) return false; const key = existing.options.applicationServerKey; return key ? encodeBytes(key) === config?.publicKey : load()?.publicKey === config?.publicKey; }
  async function readStatus(confirmEnrollment = false): Promise<PushClientStatus> {
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
        catch (error) { if (confirmEnrollment || !(error instanceof Error) || error.message !== 'device_proof_required') throw error; }
      }
      if (browser!.notification!.permission === 'denied') return { state: 'denied', enabled };
      return { state: enabled && browser!.notification!.permission === 'granted' && await subscriptionMatches() ? 'enabled' : 'ready', enabled };
    } catch (error) { if (confirmEnrollment) throw error; return { state: 'error', enabled: false }; }
  }
  const client = {
    readStatus: () => readStatus(),
    enableFromUserGesture(): Promise<PushClientStatus> {
      if (!browser?.notification || !registration || !config?.publicKey || !getPushEnvironment(browser).supported) return Promise.reject(new PushEnrollmentError(new Error('push_not_ready'), 'permission'));
      // Keep this call synchronous in the click handler, before subscription/network awaits (iOS).
      let permission: Promise<NotificationPermission>;
      try { permission = browser.notification.permission === 'granted' ? Promise.resolve('granted' as const) : browser.notification.requestPermission(); }
      catch (error) { return Promise.reject(new PushEnrollmentError(error, 'permission')); }
      return (async () => {
        let stage: PushEnrollmentStage = 'permission';
        let cacheRecovered = false;
        try {
          if (await permission !== 'granted') return { state: 'denied', enabled: false };
          stage = 'device_storage';
          let credentials = load();
          if (!credentials?.deviceId || !credentials.deviceKey) { const bytes = browser.crypto.getRandomValues(new Uint8Array(32)); credentials = { deviceId: browser.crypto.randomUUID(), deviceKey: encodeBytes(bytes) }; cacheRecovered = save(credentials, true); }
          stage = 'browser_subscription';
          let existing = await registration!.pushManager.getSubscription();
          if (existing && !await subscriptionMatches()) { await existing.unsubscribe(); existing = null; }
          const subscription = existing ?? await registration!.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePublicKey(config!.publicKey!) });
          stage = 'server_registration';
          const response = await api('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: credentials.deviceId, deviceKey: credentials.deviceKey, subscription: subscription.toJSON() }) });
          stage = 'device_storage';
          save({ ...credentials, publicKey: config!.publicKey!, epoch: response.epoch as number }, !cacheRecovered);
          stage = 'confirmation';
          const verified = await readStatus(true); if (verified.state !== 'enabled') throw new Error('enrollment_unconfirmed'); return verified;
        } catch (error) { throw new PushEnrollmentError(error, stage); }
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
