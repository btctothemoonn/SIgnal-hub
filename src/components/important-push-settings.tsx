"use client";
import { useEffect, useMemo, useState } from 'react';
import { createWebPushClient, getPushErrorMessage, type WebPushClient, type PushClientStatus } from '../lib/web-push-client.ts';

type PushLayerReport = {
  worker: { status: string; stale: boolean; errorCode: string | null; updatedAt: string | null } | null;
  cursors: Record<string, number>;
  devices: Array<{ epoch: number; enabled: boolean; enabledAt: string | null; baseline: { market: number | null; news: number | null; hynix: number | null } }>;
  outbox: Array<{ sequence: number | null; source: string; title: string; occurredAt: string | null }>;
  deliveries: Array<{ kind: string; state: string; epoch: number; attempts: number; errorCode: string | null; title: string }>;
};

export function ImportantPushSettings({ client: supplied }: { client?: WebPushClient }) {
  const client = useMemo(() => supplied ?? createWebPushClient(), [supplied]);
  const [status, setStatus] = useState<PushClientStatus | { state: 'loading' | 'enabling' | 'disabling'; enabled: boolean }>({ state: 'loading', enabled: false });
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [layers, setLayers] = useState<PushLayerReport | null>(null);
  useEffect(() => { let mounted = true; void client.readStatus().then(value => { if (mounted) setStatus(value); }); return () => { mounted = false; }; }, [client]);
  useEffect(() => {
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    void fetch('/api/push/diagnostics', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as PushLayerReport;
      if (!cancelled) setLayers(body);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  async function change(action: () => Promise<PushClientStatus>, state: 'enabling' | 'disabling') {
    setMessage('');
    try { const pending = action(); setStatus(previous => ({ state, enabled: previous.enabled })); setStatus(await pending); }
    catch (error) { setStatus(previous => ({ state: 'error', enabled: previous.enabled })); setMessage(getPushErrorMessage(error)); }
  }
  const labels: Record<string, string> = { loading: '正在检查通知状态…', unsupported: '当前浏览器暂不支持通知', home_screen: '请先添加到 iPhone 主屏幕', unconfigured: '通知服务尚未开启', denied: '系统通知权限已关闭', ready: '重要通知未开启', enabled: '通知已开启', enabling: '正在开启通知…', disabling: '正在关闭通知…', error: '通知状态需要重新确认' };
  return <section className="rounded-xl border border-workspace-line-strong bg-workspace-surface p-4 sm:p-5" aria-label="重要通知">
    <h2 className="text-base font-semibold text-foreground">重要通知</h2>
    <p className="mt-2 text-sm leading-6 text-muted">仅提醒规则确认的重要异动和重大新闻；异动优先，同一事件去重，不设置条数上限。</p>
    <p role="status" aria-live="polite" className="mt-4 font-semibold text-foreground">{labels[status.state]}</p>
    {status.state === 'home_screen' ? <p className="mt-2 text-sm leading-6 text-muted">iPhone 需要 iOS 16.4 或更新版本。在 Chrome 的分享菜单中选择“添加到主屏幕”，从新图标打开网站并登录，然后在这里开启通知。</p> : null}
    {status.state === 'denied' ? <p className="mt-2 text-sm text-muted">请在浏览器或系统设置中允许本站通知，再刷新状态。</p> : null}
    <div className="mt-4 flex flex-wrap gap-2">
      {status.state === 'ready' ? <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white" onClick={() => change(() => client.enableFromUserGesture(), 'enabling')}>开启通知</button> : null}
      {status.enabled && !['enabling', 'disabling'].includes(status.state) ? <>
        <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm text-foreground disabled:opacity-50" disabled={testing} onClick={async () => { setTesting(true); try { const result = await client.sendTest(); setMessage(result.accepted ? '测试通知已提交，请确认当前设备能看到提醒。' : '测试通知未发送，请重试。'); } catch { setMessage('测试通知未发送，请重试。'); } finally { setTesting(false); } }}>发送测试通知</button>
        <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm text-foreground" onClick={() => change(() => client.disable(), 'disabling')}>关闭通知</button>
      </> : null}
      {!['loading', 'enabling', 'disabling'].includes(status.state) ? <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm text-muted" onClick={async () => { setStatus({ state: 'loading', enabled: status.enabled }); setStatus(await client.readStatus()); }}>刷新状态</button> : null}
    </div>
    {message ? <p role="status" className="mt-3 text-sm text-muted">{message}</p> : null}
    <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs leading-5 text-muted" data-push-layers="true">
      <p className="font-semibold text-foreground">投递分层</p>
      <p>心跳只说明发送进程还在。下面分开看最近 outbox、设备 epoch 和实际投递状态，不包含订阅地址或密钥。</p>
      {layers ? <>
        <p>进程 {layers.worker ? `${layers.worker.status}${layers.worker.stale ? " · 心跳过期" : ""}` : "无心跳"}{layers.worker?.errorCode ? ` · ${layers.worker.errorCode}` : ""}</p>
        <p>游标 {Object.entries(layers.cursors).map(([key, value]) => `${key}:${value}`).join(" · ") || "尚无"}</p>
        <ul className="space-y-1">
          {layers.devices.length ? layers.devices.map((device) => <li key={`${device.epoch}-${device.enabledAt}`}>设备 epoch {device.epoch} · {device.enabled ? "启用" : "停用"} · 基线 market {device.baseline.market ?? "-"} / news {device.baseline.news ?? "-"} / hynix {device.baseline.hynix ?? "-"}</li>) : <li>没有已登记设备</li>}
        </ul>
        <ul className="space-y-1">
          {layers.outbox.length ? layers.outbox.slice(0, 5).map((event) => <li key={`${event.source}-${event.sequence}`}>outbox {event.source} #{event.sequence ?? "-"} · {event.title || "无标题"}</li>) : <li>最近没有 outbox 事件</li>}
        </ul>
        <ul className="space-y-1">
          {layers.deliveries.length ? layers.deliveries.slice(0, 5).map((delivery, index) => <li key={`${delivery.epoch}-${delivery.kind}-${index}`}>投递 {delivery.kind} · {delivery.state} · epoch {delivery.epoch}{delivery.errorCode ? ` · ${delivery.errorCode}` : ""}</li>) : <li>最近没有投递记录</li>}
        </ul>
      </> : <p>分层记录加载后显示在这里。没有记录不代表通知坏了，也可能是还没有合格事件。</p>}
      <p>Windows：关闭网站标签页后仍可收到通知，Chrome 进程须继续运行，并允许系统通知。</p>
      <p>登录状态到期后通知仍继续；主动退出登录或关闭通知会停止当前设备的推送。其他设备独立管理。</p>
      <p>通知标题和内容可能显示在桌面或锁屏上。系统专注模式、网络和通知设置会影响显示。</p>
    </div>
  </section>;
}
