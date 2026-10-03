import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function releaseVersion(): string {
  try {
    const version = readFileSync(join(process.cwd(), ".release-commit"), "utf8").trim();
    if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(version)) return version;
  } catch {
    // Local builds do not have the VPS release marker.
  }
  return randomUUID();
}

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Freeze the same version into the browser bundle and the version API.
  // Reading the first API reply as a baseline would miss an already-stale tab.
  env: { NEXT_PUBLIC_SIGNAL_HUB_VERSION: releaseVersion() },
  experimental: {
    cpus: 1,
    parallelServerBuildTraces: false,
    parallelServerCompiles: false,
    webpackBuildWorker: false,
    workerThreads: true,
  },
};

export default nextConfig;
