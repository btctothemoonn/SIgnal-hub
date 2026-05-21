import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import {
  getSystemHealthSnapshot,
  type SystemdServiceState,
} from "@/lib/system-health";
import { SIGNAL_HUB_SYSTEMD_SERVICES } from "@/lib/signal-hub-services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function systemctlIsActive({
  label,
  name,
}: {
  label: string;
  name: string;
}): Promise<SystemdServiceState> {
  return new Promise((resolve) => {
    execFile(
      "systemctl",
      ["is-active", name],
      { timeout: 1200 },
      (error, stdout, stderr) => {
        const activeState = stdout.trim() || (error ? "unknown" : "active");
        const detail = stderr.trim() || (error instanceof Error ? error.message : "");
        resolve({ name, label, activeState, ...(detail ? { detail } : {}) });
      },
    );
  });
}

async function readSystemdServiceStates(): Promise<SystemdServiceState[]> {
  if (process.platform !== "linux") return [];
  return Promise.all(SIGNAL_HUB_SYSTEMD_SERVICES.map(systemctlIsActive));
}

export async function GET() {
  const serviceStates = await readSystemdServiceStates();
  const snapshot = await getSystemHealthSnapshot({ serviceStates });
  return NextResponse.json(snapshot);
}
