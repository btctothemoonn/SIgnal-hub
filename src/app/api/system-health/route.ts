import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import {
  getSystemHealthSnapshot,
  type SystemdServiceState,
} from "@/lib/system-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVICES = [
  "signal-hub-web",
  "signal-hub-telegram",
  "signal-hub-x-hybrid",
  "signal-hub-monitor985",
  "signal-hub-stocks-cache",
  "signal-hub-alpha-summary",
  "signal-hub-tiger-holdings",
];

function systemctlIsActive(service: string): Promise<SystemdServiceState> {
  return new Promise((resolve) => {
    execFile(
      "systemctl",
      ["is-active", service],
      { timeout: 1200 },
      (error, stdout, stderr) => {
        const activeState = stdout.trim() || (error ? "unknown" : "active");
        const detail = stderr.trim() || (error instanceof Error ? error.message : "");
        resolve({ name: service, activeState, ...(detail ? { detail } : {}) });
      },
    );
  });
}

async function readSystemdServiceStates(): Promise<SystemdServiceState[]> {
  if (process.platform !== "linux") return [];
  return Promise.all(SERVICES.map(systemctlIsActive));
}

export async function GET() {
  const serviceStates = await readSystemdServiceStates();
  const snapshot = await getSystemHealthSnapshot({ serviceStates });
  return NextResponse.json(snapshot);
}
