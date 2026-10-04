import { DatabaseSync } from "node:sqlite";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "../../../../lib/admin-auth.ts";
import { loadRuntimeConfig } from "../../../../lib/runtime-config.ts";
import { getXPipelineConfiguredAccounts } from "../../../../lib/x-pipeline-accounts.ts";
import { getXPipelineConfig } from "../../../../lib/x-pipeline-config.ts";
import { getXAccountCoverageSnapshot } from "../../../../lib/x-owned-reader-state.ts";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, noarchive"};

export async function GET(request:Request) {
  // The proxy verifies this cookie too; keep the read boundary protected in isolation.
  const token=(request.headers.get("cookie") || "").split(";").map(part=>part.trim()).find(part=>part.startsWith(`${ADMIN_SESSION_COOKIE}=`))?.slice(ADMIN_SESSION_COOKIE.length+1);
  if(!verifyAdminSessionToken(token))return Response.json({success:false,error:"Unauthorized"},{status:401,headers});
  let db:DatabaseSync|undefined;
  try {
    const accounts=getXPipelineConfiguredAccounts(await loadRuntimeConfig());
    db=new DatabaseSync(getXPipelineConfig().dbPath,{readOnly:true});
    return Response.json(getXAccountCoverageSnapshot(accounts.map(account=>account.username),db),{headers});
  } catch {
    return Response.json({success:false,error:"coverage_unavailable"},{status:503,headers});
  } finally {db?.close();}
}
