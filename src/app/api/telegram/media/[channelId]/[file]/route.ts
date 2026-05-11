import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getTelegramPipelineConfig } from "@/lib/telegram-pipeline-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function contentType(file: string) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "image/jpeg";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ channelId: string; file: string }> },
) {
  const { channelId, file } = await context.params;
  const mediaDir = resolve(getTelegramPipelineConfig().mediaDir);
  const target = resolve(join(mediaDir, channelId, file));

  if (!target.startsWith(mediaDir)) {
    return new Response("Invalid media path", { status: 400 });
  }

  try {
    const bytes = await readFile(target);
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType(file),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
