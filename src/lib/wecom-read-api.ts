import { authorizeWecomRead, wecomErrorResponse, wecomPrivateJson } from "./wecom-access.ts";
import { WecomError } from "./wecom-errors.ts";
import { getWecomCaAlerts, getWecomReport, getWecomReports, getWecomStatus } from "./wecom-store.ts";
import type { WecomCadence, WecomEnv } from "./wecom-types.ts";

type ReadKind = "reports" | "ca-alerts" | "status";
export async function handleWecomRead(request: Request, kind: ReadKind, { env = process.env, now = Date.now() }: { env?: WecomEnv; now?: number } = {}): Promise<Response> {
  try {
    const access = authorizeWecomRead(request, env);
    const params = new URL(request.url).searchParams;
    const allowed = kind === "reports" ? ["id", "cadence", "limit", "before", "deviceId"] : kind === "ca-alerts" ? ["active", "limit", "before", "deviceId"] : ["deviceId"];
    for (const [key, value] of params) {
      if (!allowed.includes(key) || params.getAll(key).length !== 1 || !value || value.length > 4096) throw new WecomError("invalid_query");
    }
    const options = { ...access, env, now };
    if (kind === "status") return wecomPrivateJson(getWecomStatus(options));
    if (kind === "reports" && params.has("id")) {
      if (["cadence", "limit", "before"].some(key => params.has(key))) throw new WecomError("invalid_query");
      const id = params.get("id")!;
      if (id.length > 1024 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new WecomError("invalid_query");
      const detail = getWecomReport(id, options);
      return detail ? wecomPrivateJson(detail) : wecomPrivateJson({ error: "not_found" }, 404);
    }
    const activeValue = params.get("active");
    if (activeValue !== null && activeValue !== "1") throw new WecomError("invalid_query");
    const active = activeValue === "1";
    if (active && params.has("before")) throw new WecomError("invalid_query");
    const limitValue = params.get("limit") ?? (active ? "50" : "10");
    if (!/^[1-9]\d?$/.test(limitValue) || Number(limitValue) > (active ? 50 : 10)) throw new WecomError("invalid_query");
    const limit = Number(limitValue), before = params.get("before") ?? undefined;
    if (kind === "ca-alerts") return wecomPrivateJson(getWecomCaAlerts({ ...options, active, limit, before }));
    const cadence = params.get("cadence") ?? "two_hour";
    if (!["two_hour", "six_hour", "daily"].includes(cadence)) throw new WecomError("invalid_query");
    return wecomPrivateJson(getWecomReports({ ...options, cadence: cadence as WecomCadence, limit, before }));
  } catch (error) { return wecomErrorResponse(error); }
}
