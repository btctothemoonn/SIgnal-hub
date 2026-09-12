import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WecomPanel } from "@/components/wecom-panel";
import { authorizeWecomRead } from "@/lib/wecom-access";
import { WecomError } from "@/lib/wecom-errors";
import { getWecomCaAlerts, getWecomReports } from "@/lib/wecom-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function Unavailable() {
  return <AppShell activeNav="wecom"><section className="py-4"><h2 className="text-lg font-semibold">企业微信</h2><p role="alert" className="mt-3 text-sm text-muted">企业微信数据不可用，请确认当前账号的设备访问授权。</p></section></AppShell>;
}

export default async function WecomPage() {
  let access;
  try {
    const requestHeaders = await headers();
    const request = new Request("http://localhost/wecom", { headers: requestHeaders });
    access = await authorizeWecomRead(request);
  } catch (error) {
    if (error instanceof WecomError && error.status === 401) redirect("/login?next=%2Fwecom");
    return <Unavailable />;
  }

  let initialReports = null;
  let initialAlerts = null;
  let initialError = null;
  try {
    initialReports = getWecomReports({ ...access, cadence: "six_hour", limit: 10 });
    initialAlerts = getWecomCaAlerts({ ...access, active: true, limit: 50 });
  } catch (error) {
    if (error instanceof WecomError && error.status === 401) redirect("/login?next=%2Fwecom");
    if (error instanceof WecomError && error.status === 403) return <Unavailable />;
    initialReports = null;
    initialAlerts = null;
    initialError = "企业微信数据读取失败，请稍后重试。";
  }

  return <AppShell activeNav="wecom" mainClassName="mx-auto min-h-0 w-full max-w-[1680px] px-3 py-4 sm:px-5">
    <WecomPanel initialReports={initialReports} initialAlerts={initialAlerts} initialError={initialError} />
  </AppShell>;
}
