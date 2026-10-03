/* Notifications only. Private pages and APIs are deliberately never cached. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
function safeTarget(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/settings', self.location.origin);
    if (url.origin === self.location.origin && !url.username && !url.password && ['/alerts', '/intel', '/settings'].includes(url.pathname)) return url.href;
  } catch {}
  return new URL('/settings', self.location.origin).href;
}
self.addEventListener('push', event => {
  let data;
  try { data = event.data.json(); } catch { data = null; }
  const title = typeof data?.title === 'string' && data.title.trim() ? data.title.slice(0, 120) : 'Signal Hub';
  const body = typeof data?.body === 'string' ? data.body.slice(0, 320) : '收到一条重要提醒，请打开网站查看。';
  const episode = typeof data?.episodeId === 'string' ? data.episodeId.slice(0, 180) : 'important';
  event.waitUntil(self.registration.showNotification(title, { body, tag: `signal-hub:${episode}`, icon: '/icon-192x192.png', badge: '/icon-192x192.png', data: { target: safeTarget(data?.target) } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = safeTarget(event.notification.data?.target);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = windows.find(window => { try { return new URL(window.url).origin === self.location.origin; } catch { return false; } });
    if (current) { const navigated = await current.navigate(target); await (navigated ?? current).focus(); }
    else await self.clients.openWindow(target);
  })());
});
