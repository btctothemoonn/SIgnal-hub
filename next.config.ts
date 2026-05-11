import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    cpus: 1,
    parallelServerBuildTraces: false,
    parallelServerCompiles: false,
    webpackBuildWorker: false,
    workerThreads: true,
  },
};

export default nextConfig;
