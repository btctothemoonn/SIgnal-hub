import { AppShell } from "@/components/app-shell";
import { DouyinMonitorPanel } from "@/components/douyin-monitor-panel";
import { getDouyinSnapshot } from "@/lib/douyin-monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_ENDPOINT = "/api/douyin";

export default async function DouyinPage() {
  const snapshot = await getDouyinSnapshot();

  return (
    <AppShell
      activeNav="douyin"
      subtitle="抖音公开视频监控 · 投研摘要 · 独立缓存"
      mainClassName="mx-auto w-full max-w-[1500px] min-h-0 px-3 py-4 sm:px-5"
      statusPills={[
        {
          label: "Douyin",
          status:
            snapshot.status === "ok"
              ? "在线"
              : snapshot.status === "partial"
                ? "部分失败"
                : snapshot.configured
                  ? "待刷新"
                  : "待配置",
          tone:
            snapshot.status === "ok"
              ? "text-success"
              : snapshot.status === "error"
                ? "text-danger"
                : "text-warning",
          children: `${snapshot.creators.length} 博主 · ${snapshot.videos.length} 条`,
        },
      ]}
    >
      <DouyinMonitorPanel
        initialSnapshot={snapshot}
        apiEndpoint={API_ENDPOINT}
        refreshEndpoint={`${API_ENDPOINT}/refresh`}
      />
    </AppShell>
  );
}
