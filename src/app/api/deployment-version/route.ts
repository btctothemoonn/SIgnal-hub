export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { version: process.env.NEXT_PUBLIC_SIGNAL_HUB_VERSION },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
