import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { canonicalWecomSignature } from "../src/lib/wecom-signature";

test.skip(!process.env.SIGNAL_WECOM_E2E_RUNTIME, "Use playwright.wecom.config.ts for isolated synthetic receiver");
const secret="TEST-ONLY-wecom-cross-language-synthetic-secret";
const fixture=(name:string)=>JSON.parse(readFileSync(resolve(`docs/integrations/wecom-summary/${name}.example.json`),"utf8"));
async function ingest(request:APIRequestContext, packet:unknown) {
  const body=JSON.stringify(packet), headers=new Headers({"content-type":"application/json","x-wecom-device":"mac-synthetic","x-wecom-timestamp":String(Math.floor(Date.now()/1000)),"x-wecom-nonce":randomBytes(16).toString("hex")});
  headers.set("x-wecom-signature",createHmac("sha256",secret).update(canonicalWecomSignature(headers,Buffer.from(body))).digest("hex"));
  return request.post("/api/wecom/ingest",{headers:Object.fromEntries(headers),data:body});
}

test("actual receiver and browser: synthetic Mac export, full reports, CA and private session",async({page,request},testInfo)=>{
  const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  for(const path of ["reports","ca-alerts","status"]){const res=await request.get(`/api/wecom/${path}`);expect(res.status()).toBe(401);expect(res.headers()["cache-control"]).toContain("no-store");}
  expect((await request.post("/api/wecom/ingest",{data:{}})).status()).toBe(401);
  expect((await request.put("/api/wecom/ingest",{data:{}})).status()).toBe(401);
  expect((await request.post("/api/wecom/ingest/nested",{data:{}})).status()).toBe(401);
  await page.goto("/wecom"); await expect(page).toHaveURL(/\/login\?/);
  await page.locator('input[name="password"]').fill(process.env.SIGNAL_E2E_PASSWORD!);
  await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/\/wecom$/);
  const privatePage=await page.request.get("/wecom"); expect(privatePage.headers()["cache-control"]).toContain("private"); expect(privatePage.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading",{name:"企业微信",exact:true})).toBeVisible();
  await expect(page.getByText("此周期暂无简报")).toBeVisible();
  expect((await page.request.get("/api/wecom/reports?deviceId=foreign")).status()).toBe(403);

  const macRoot=process.env.WECOM_MAC_TEST_ROOT;
  const python=process.env.WECOM_TEST_PYTHON;
  expect(macRoot,"Set WECOM_MAC_TEST_ROOT to pinned bcb544a archive").toBeTruthy();
  expect(python,"Set WECOM_TEST_PYTHON to Python 3").toBeTruthy();
  const generated=JSON.parse(execFileSync(python!,["scripts/wecom-mac-synthetic.py","--mac-root",macRoot!],{encoding:"utf8",timeout:15000}));
  for(const packet of generated.packets){const res=await request.post("/api/wecom/ingest",{headers:packet.headers,data:packet.body});expect(res.status(),await res.text()).toBe(200);}
  const report=JSON.parse(generated.packets[0].body).report;
  const alert=JSON.parse(generated.packets[1].body).alert;
  const detail=await page.request.get(`/api/wecom/reports?id=${encodeURIComponent(report.id)}`);
  expect(detail.headers()["cache-control"]).toBe("private, no-store"); expect((await detail.json()).report).toEqual(report);
  const active=await page.request.get("/api/wecom/ca-alerts?active=1&limit=50");
  const stored=(await active.json()).items.find((item:{id:string})=>item.id===alert.id);
  expect(stored.delayed).toBe(false); expect(stored.effectiveStatus).toBe("active");
  await expect(page.getByRole("region",{name:"CA 跨群提及"}).getByText(alert.address,{exact:true})).toBeVisible({timeout:20000});
  await expect(page.getByLabel("新跨群提及",{exact:true})).toBeVisible();
  const visibleAt=Date.now();
  expect(visibleAt-generated.timing.sourceCommittedAt*1000).toBeLessThanOrEqual(60000);
  await testInfo.attach("synthetic-latency.json",{body:JSON.stringify({...generated.timing,firstReceivedAt:stored.firstReceivedAt,visibleAt:new Date(visibleAt).toISOString(),sourceToVisibleMs:visibleAt-generated.timing.sourceCommittedAt*1000,outboxTested:false},null,2),contentType:"application/json"});
  await page.getByRole("button",{name:"刷新企业微信",exact:true}).click();
  await page.getByRole("button",{name:"展开简报",exact:true}).first().click();
  for(const heading of ["项目动态","事件","信息缺口","报告窗口 CA 聚合","范围与完整性","来源元数据"]) await expect(page.getByRole("heading",{name:heading,exact:true})).toBeVisible();
  await expect(page.getByText("合成研究甲群 · 合成昵称甲",{exact:true})).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SYNTHETIC_RAW_SENTINEL");
  await page.setViewportSize({width:1440,height:1000}); await page.screenshot({path:testInfo.outputPath("wecom-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("wecom-mobile.png"),fullPage:true});
  await page.reload(); await expect(page.getByLabel("新跨群提及",{exact:true})).toHaveCount(0);

  const business=fixture("report-business"); business.report.id=business.report.id.replace(/wecom:[^:]+:/,"wecom:mac-synthetic:");
  expect((await ingest(request,business)).status()).toBe(200);
  await page.getByRole("button",{name:"6 小时",exact:true}).click();
  await page.getByRole("button",{name:"展开简报",exact:true}).first().click();
  for(const heading of ["业务进展","通知","阻塞","待办"]) await expect(page.getByRole("heading",{name:heading,exact:true})).toBeVisible();
  await page.route("**/api/wecom/**",route=>route.fulfill({status:503,contentType:"application/json",body:'{"error":"synthetic_outage"}'}));
  await page.getByRole("button",{name:"刷新企业微信",exact:true}).click();
  await expect(page.getByRole("heading",{name:"业务简报",exact:true})).toBeVisible();
  await page.unrouteAll();
  await page.context().clearCookies();
  await page.getByRole("button",{name:"刷新企业微信",exact:true}).click();
  await expect(page).toHaveURL(/\/login\?/); await expect(page.locator("body")).not.toContainText("合成研究甲群");
  expect(errors).toEqual([]);
});
