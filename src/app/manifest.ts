import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Signal Hub",
    short_name: "Signal Hub",
    description:
      "Private real-time signal dashboard for Telegram, X, market alerts, and holdings.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#111817",
    theme_color: "#111817",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
