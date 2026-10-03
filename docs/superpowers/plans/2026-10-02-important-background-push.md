# Important Background Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows Chrome 和 iPhone 主屏幕应用中提供只提醒重要事件的后台系统通知，不限制条数，重要异动优先。

**Architecture:** 行情与简报生产者把有效事件及来源证据写入各自 SQLite 的事务 outbox。独立推送进程把事件扇出到每台已启用设备的持久队列，完成去重、过期校验和 Web Push 发送。设置页管理当前设备，Service Worker 显示通知并打开安全站内目标。

**Tech Stack:** 现有 Next.js 16.2.12、React 19.2.4、TypeScript、Node.js >=22.5.0、node:sqlite、pnpm、Web Push、Service Worker、node:assert/strict 和 Playwright。

**Spec:** [已批准的设计](../specs/2026-10-02-important-background-push-design.md)。设计已批准，本实现计划待审阅和选择执行方式。

## Global Constraints

- “不设每日、每小时条数上限，也不设所有事件之间的强制间隔”。不改变原有行情采集范围或页面数量限制。
- “重要异动先发送，重要新闻随后发送”。并发四个槽位，三个保留给异动，一个保留给新闻；同类最旧任务先发送。
- “同一事件去重、合并重复来源，仅在出现新的实质变化时再次提醒”。同事件合并等待最多五秒，不阻塞其他事件。
- 机会确认要求 score >= 现有 actionableScore（80）、confidence >=80、mandatoryComplete、未失效、行情不 stale，且 decision 为“关注做多”或“关注做空”。观测及抓取时间合法并在 enrichmentFreshMs（2 分钟）内。
- raw squeeze 只接收规则确认的 level 3“轧空加速”，完整保存评分输入和观测时间；重用 scoreShortSqueeze，不另造行情评分。
- 异动有效发送窗口为确认后 2 分钟。新闻真实发布时间及简报生成时间均在过去 12 小时内，待发窗口 1 小时；新闻还须晚于当前设备启用时间。
- 首次启用、重新启用不补发旧事件；进程重启恢复尚新鲜的已有任务。缺数据、断线、排名和文案变化不能重置异动 episode。
- iPhone 需 iOS 16.4+、添加到主屏幕、从主屏幕图标打开后主动启用；Windows 关闭网站标签页时 Chrome 进程仍须运行。
- 只支持精确推送域名 fcm.googleapis.com、web.push.apple.com；HTTPS、无用户名口令、无片段、标准 HTTPS 端口、不跟随重定向。
- 私钥不进入源码、浏览器、响应或日志；控制 API 要求登录和同源修改。默认不缓存私有页面或 API。
- 新闻复用现有简报请求，不增加逐条消息 AI 调用，不创建新的 AI 凭据。旧缓存缺少评估或真实发布时间依据时不推送。

## Review Focus

1. 明明是同一异动，WS、机会确认、轧空或重启却重复提醒：任务 1、2、4 覆盖共享 episode、最高阶段及已投递状态。
2. 缺字段或采集断线被误认为恢复，重连后旧信号再弹出：任务 1、2 覆盖 incomplete 不计入结束扫描。
3. 新闻时间解析失败回退到当前时间，或旧批次候选编号重新关联：任务 3 覆盖可信时间依据和逐条来源记录。
4. 用户关闭通知或退出登录后，已领取的任务继续发送；另一设备也被误关闭：任务 4、5、6 覆盖当前 epoch 和领取后再次核验。
5. 持续异动和提供商 429 同时到来，使新闻饥饿或异常队列突破过期时间：任务 4、5 覆盖保留并发、Retry-After 及到期记录；任务 8 覆盖旧版本缺脚本回滚。

## 文件边界和执行准备

| 单元 | 新增或修改位置 | 责任 |
| --- | --- | --- |
| 共享契约与纯规则 | 新增 src/lib/important-push-types.ts、important-push-policy.ts | 时间、资格、模型状态和 episode 转换，不访问网络 |
| 生产者 outbox | 新增 src/lib/important-push-outbox.ts；修改 market-alerts-store.ts、market-opportunity-worker.ts、market-alerts-binance.ts | 同库事务、完整输入、递增序号和读取 |
| 新闻来源及重大评估 | 新增 src/lib/important-news-push.ts；修改 daily-brief-independent-sources.ts、daily-investment-brief.ts | 可信时间、分类评估、缓存与事件一起提交 |
| 设备及投递状态 | 新增 src/lib/web-push-config.ts、web-push-store.ts | VAPID 配置状态、设备凭证、epoch、游标、任务和租约 |
| 发送与后台循环 | 新增 src/lib/web-push-sender.ts、web-push-worker.ts、scripts/web-push-worker.mjs | 加密发送、优先级、重试、健康和停机 |
| 登录保护 API | 新增 src/lib/web-push-api.ts、src/app/api/push/{config,subscriptions,test}/route.ts | 当前设备操作及测试通知 |
| 浏览器功能 | 新增 public/sw.js、src/lib/web-push-client.ts、src/components/important-push-settings.tsx；修改 settings/page.tsx、app-shell.tsx、api/logout/route.ts | 权限、启用关闭、主屏幕指引及退出登录 |
| 部署及健康 | 修改 system-health.ts、signal-hub-services.ts、deploy-vps.sh、package.json、pnpm-lock.yaml、.env.example | 独立服务、依赖、配置说明及回滚 |

实施前使用 using-git-worktrees 创建或复用隔离工作区，从包含已批准设计及本计划的提交开始；不在 main 直接写产品代码。遵守 AGENTS.md，在写 Next.js 代码前读取 node_modules/next/dist/docs 的 route handlers、cookies 和 proxy 指南；本次普通读取被拒绝，执行时先解决只读访问，不能假装已经读过。当前可用 node 为 v24.19.0，pnpm 可用；不安装或降级系统运行时。

测试沿用独立 .test.mjs、固定 nowMs、临时 SQLite 和注入客户端；路由测试沿用现有 registerHooks 或转译 stub，组件测试沿用 react-test-renderer。不要调用真实新闻、行情、AI 或推送服务。下面测试例中的 fixture 来自各任务测试文件本地的完整有效输入，参照 market-alerts-store.test.mjs 和 market-opportunity-worker.test.mjs。

统一定向命令为 `node --experimental-strip-types --experimental-transform-types <测试文件>`。每个任务先运行新测试确认缺少实现或行为断言失败，修复后再运行相关回归；提交只包含该任务的明确文件。任务 2、3 共用 outbox 契约且触及既有大文件，应依次集成。

## Task 1 重要性及 episode 纯规则

**Files:** 新增 src/lib/important-push-types.ts、src/lib/important-push-policy.ts、src/lib/important-push-policy.test.mjs。

**Interfaces:**

- PushEvent 包含 id、source（market、news 或 test）、episodeId、stage（confirmed、squeeze_acceleration、exceptional_news 或 test）、priority（0 或 1）、title、body、target、occurredAt、expiresAt、sourcePublishedAt（string 或 null）、ruleVersion、evidence（string[]）。日期统一合法 ISO UTC；priority 0 为异动。test 只用于控制接口直接测试，不进入生产者 outbox 或真实事件基线；游标来源只有 market 和 news。
- EnvLike 为 `Record<string, string | undefined>`，所有配置读取与测试注入使用同一类型。
- MarketPushObservation 包含 symbol、direction、producer（opportunity 或 squeeze）、model、scanId、observedAt、fetchedAt、classification（qualified、complete_unqualified、invalidated、recovered、incomplete）、stage、evidence（string[]）、opportunityDecision（可选 MarketOpportunityDecision）、squeezeMetrics（可选 SqueezeMetrics）和 minOiNotional（可选 number）。参与者键固定为 `${producer}:${model}`；每个参与者的 scanId 只能计算一次，完整输入保存在对应类型字段。
- PushEpisodeState 保存 episodeId、symbol、direction、按参与者键保存的状态和 complete_unqualified 扫描计数、最高阶段、开始与结束时间。两类 producer 同方向共享 episode，但不互相覆盖最新输入或扫描计数。
- `qualifyOpportunity(input: {decision: MarketOpportunityDecision; enrichment: {fetchedAt: string; stale: boolean; error: string | null}; scanId: string}, nowMs: number): MarketPushObservation`。
- `qualifySqueeze(input: {symbol: string; metrics: SqueezeMetrics; minOiNotional: number; observedAt: string; fetchedAt: string; scanId: string; recovered: boolean | null}, nowMs: number): MarketPushObservation`。
- `transitionPushEpisode(previous: PushEpisodeState | null, observations: MarketPushObservation[], nowMs: number): {state: PushEpisodeState | null; event: PushEvent | null}`。

- [x] **Step 1 写资格和转换测试。** 测试 score 79、confidence 79、等待确认、禁止追单、缺字段、future、stale、超过 2 分钟和 expiresAt 过期都不 qualified；有效机会为 confirmed；完整 level 3 squeeze 为 squeeze_acceleration，level 2 不 qualified。同方向多模型合并，只允许阶段升级。机会参与者在三个不同完整扫描未确认或 hardInvalidated 后结束；原始 squeeze 参与者只在有效 recovery 后结束，不因跌到 level 2 或完整未确认次数结束。全部参与者结束后才能开新 episode，incomplete 不增加计数。机会 short_squeeze 和原始 squeeze:short_squeeze 分别计数，不互相覆盖。

```js
assert.equal(qualifyOpportunity({decision: {...fixture, score: 79}, enrichment, scanId: "scan-1"}, nowMs).classification, "complete_unqualified");
assert.equal(qualifyOpportunity({decision: {...fixture, metrics: {...fixture.metrics, stale: true}}, enrichment, scanId: "scan-1"}, nowMs).classification, "incomplete");
assert.equal(transitionPushEpisode(alreadyConfirmed, [sameConfirmation], nowMs).event, null);
assert.equal(transitionPushEpisode(alreadyConfirmed, [confirmedAcceleration], nowMs).event.stage, "squeeze_acceleration");
```

- [x] **Step 2 运行 important-push-policy.test.mjs，确认新模块缺失或资格断言失败。**
- [x] **Step 3 按上述签名实现。** 使用现有 SqueezeMetrics、scoreShortSqueeze 和 MARKET_OPPORTUNITY_RULES；输入缺失与明确未确认必须分开。不要把页面名单 enteredAt 用作身份；生成固定 episodeId 后一直保存，缺失观测不结束。通知 target 固定站内 `/alerts?symbol=...`，不接收素材里的任意地址。
- [x] **Step 4 运行新测试及 market-alerts-core.test.mjs、market-opportunity-core.test.mjs，全部通过。**
- [x] **Step 5 提交规则模块及测试。** 提交信息 `feat: define important market push qualification`。

## Task 2 行情事务 outbox 和完整生产者输入

**Files:** 新增 src/lib/important-push-outbox.ts、src/lib/important-push-outbox.test.mjs；修改 src/lib/market-alerts-store.ts、market-opportunity-worker.ts、market-alerts-binance.ts；新增 src/lib/market-push-producers.test.mjs，并扩展对应既有 store 和 worker 测试。

**Interfaces:**

- `createImportantPushOutbox(db: DatabaseSync)` 提供 `applyMarketObservations(observations: MarketPushObservation[], nowMs: number): PushEvent[]`、`appendEvent(event: PushEvent): number`、`readAfter(sequence: number, limit: number): Array<{sequence: number; event: PushEvent}>`、`readLatestEvaluation(symbol: string, participantKey: string): MarketPushObservation | null`、`readEpisode(episodeId: string): PushEpisodeState | null`、`getBaseline(): {lastSequence: number; episodes: PushEpisodeState[]}`。
- 在 openMarketAlertsStore 返回值新增 `commitOpportunityScan(input: {states: MarketOpportunityCandidateState[]; pushObservations: MarketPushObservation[]; scannedAt: string}): void`、`commitSqueezePushScan(input: {pushObservations: MarketPushObservation[]; scannedAt: string}): void`、`readMarketPushOutboxAfter(sequence: number, limit: number)`、`getMarketPushBaseline()`、`readMarketPushEvaluation(symbol: string, participantKey: string)`、`readMarketPushEpisode(episodeId: string)`；读取返回任务 1 类型。
- 保留 replaceOpportunityCandidateStates 的兼容性，现有用户调用及名单行为不变；新 worker 使用 commitOpportunityScan。

- [x] **Step 1 写原子提交和完整输出测试。** SQLite trigger 注入 outbox 写入失败后，候选、episode 和事件全部回滚。相同时间戳、超过页面前五名的有效结果均可读出；序号递增，重复 scanId 幂等。验证所有参与模型可结束 episode，缺失模型不会结束。Telegram 失败不取消已提交的独立 push 决策。

```js
assert.throws(() => store.commitOpportunityScan(scanWithInjectedOutboxFailure));
assert.deepEqual(store.getOpportunityCandidateStates(), beforeFailure);
assert.equal(store.readMarketPushOutboxAfter(0, 100).length, 8);
assert.equal(store.readMarketPushEvaluation("BTCUSDT", "squeeze:short_squeeze").squeezeMetrics.breakout20, true);
```

- [x] **Step 2 运行 important-push-outbox.test.mjs 与 market-push-producers.test.mjs，确认新增接口和原子断言失败。**
- [x] **Step 3 实现 episode、latest_evaluation 和 append-only outbox 表及事务。** 用 INTEGER PRIMARY KEY AUTOINCREMENT sequence 处理时间相同事件，latest_evaluation 使用 symbol 和参与者键唯一。runMarketOpportunityScan 保留三个评分模型的结果，仅向原名单交付现有 chosen decision；不要拿 carried-forward 候选作为新观测。runSqueezeScan 在 Telegram 网络发送前保存每个完整评分结果及合法 recovery，包括不合格和未升级结果，以便发送时新鲜度检查；完整保存 breakout20、minOiNotional 和真实来源时间。原 Telegram 发送、guard 和恢复流程独立保留，不在数据库事务内等待网络。
- [x] **Step 4 运行新增测试及 src/lib/market-alerts-store.test.mjs、src/lib/market-opportunity-worker.test.mjs、src/lib/market-alerts-binance.test.mjs。** 这些现有文件均已核实存在，必须通过。
- [x] **Step 5 提交 outbox、生产者集成及测试。** 提交信息 `feat: persist important market push events atomically`。

## Task 3 新闻时间依据和重大评估

**Files:** 新增 src/lib/important-news-push.ts、src/lib/important-news-push.test.mjs；修改 src/lib/daily-brief-independent-sources.ts、daily-investment-brief.ts，以及对应 .test.mjs。

**Interfaces:**

- SourceTimeBasis 为 publication、discovery 或 fallback。ValidatedNewsSource 为 sourceId、canonicalUrl、source、publishedAt（可信发布依据时为 ISO，否则 null）和 timeBasis。
- DailyBriefCandidate 和 IndependentDailyBriefCandidate 保留原 publishedAt 展示兼容，新增可选 publicationTimeBasis；服务端来源映射保存可信时间，不接受模型填时间。
- PushAssessment 为 exceptional、category（批准设计中的四种类别，非重大项为 null）、fact、impact、candidateIndexes；DailyBriefItem 新增可选 pushAssessment、validatedSources 和 pushEventId。旧缓存的缺省值为推送不合格。
- `qualifyImportantNews(input: {item: DailyBriefItem; generatedAt: string}, nowMs: number): PushEvent | null`；`createImportantNewsPushStore(db: DatabaseSync)` 提供 `appendGeneratedBrief(snapshot: DailyBriefSnapshot, nowMs: number): {events: PushEvent[]; snapshot: DailyBriefSnapshot}`、`readAfter(sequence: number, limit: number)` 和 `getBaseline(): {lastSequence: number}`，复用任务 2 的 outbox 契约。返回 snapshot 逐条保留已经绑定的 pushEventId，使通知目标与页面定位一致。
- 新增纯缓存读取导出 `readDailyBriefPushOutboxAfter(sequence: number, limit: number, env?: EnvLike)` 和 `getDailyBriefPushBaseline(env?: EnvLike)`；不调用 getOrCreateDailyInvestmentBrief。

- [x] **Step 1 写可信时间、类别和来源测试。** 合法 RSS pubDate 可供 freshness 判断；GDELT seendate、解析失败 fallback、未来日期不推送。high 但缺 exceptional 为假；普通评论、不在枚举中的类别、模型伪造 URL 和旧 batch index 均不推送。相同 URL/规范化标题去重；来源与简报缓存事务回滚时没有新 outbox。

```js
assert.equal(qualifyImportantNews({item: legacyHighItem, generatedAt: now}, nowMs), null);
assert.equal(qualifyImportantNews({item: {...exceptionalItem, validatedSources: discoveryOnly}, generatedAt: now}, nowMs), null);
assert.equal(qualifyImportantNews({item: exceptionalItem, generatedAt: now}, nowMs).priority, 1);
```

- [x] **Step 2 运行 important-news-push.test.mjs，确认缺少模块及新字段规则失败。**
- [x] **Step 3 扩展现有简报请求中的 prompt 和解析，不增加请求数。** 在 sanitizeBriefForCandidates 附加实际匹配来源记录和经过检查的 assessment，mergeDailyBriefContent 保留逐条映射且不跨批次复用编号；所有 collector 都显式标注时间依据。writeCachedBrief 对成功 generated 结果在同库事务内提交去重、outbox 和返回的带 pushEventId 缓存，缓存复用或失败回退不产生事件。来源 hostname 使用精确合法域名匹配；不要为补时间抓任意 URL。修改 API 调用侧前，按适用凭据技能核实已授权复用的现有 provider；不生成新密钥，测试只注入假 provider。
- [x] **Step 4 运行新测试及 daily-investment-brief.test.mjs、daily-brief-independent-sources.test.mjs、daily-brief-consolidation.test.mjs、daily-investment-brief-prewarm.test.mjs。** 检查现有简报三类、独立来源和定时请求次数不变。
- [x] **Step 5 提交新闻来源及事件记录。** 提交信息 `feat: gate news pushes on exceptional verified candidates`。

## Task 4 设备订阅和持久发送队列

**Files:** 新增 src/lib/web-push-config.ts、web-push-store.ts、web-push-store.test.mjs、web-push-config.test.mjs。

**Interfaces:**

- `getWebPushConfig(env?: EnvLike): {enabled: boolean; configured: boolean; publicKey: string | null; privateKey: string | null; subject: string | null; errorCode: string | null}`；只有内部 sender 可读取私钥，API 映射只返回 configured/publicKey。
- 环境变量固定为 WEB_PUSH_ENABLED、WEB_PUSH_VAPID_PUBLIC_KEY、WEB_PUSH_VAPID_PRIVATE_KEY、WEB_PUSH_VAPID_SUBJECT、SIGNAL_HUB_PUBLIC_ORIGIN。生产启用时公共 origin 必须为明确的合法 HTTPS origin；测试和本地开发可用明确的 localhost/127.0.0.1 origin。运行数据使用 getRuntimeDataPath(env, "web-push.sqlite")。
- `validatePushSubscription(input: unknown): PushSubscriptionJSON` 仅接受允许 endpoint、合法 65 字节 p256dh 公钥、16 字节 auth、有限正文；拒绝 http、凭据、片段、非默认端口和 host 欺骗。
- `openWebPushStore(path?: string)` 提供 enrollDevice、getDeviceStatus、revokeDevice、readSourceCursor、ingestSourceEventsAndAdvanceCursor、claimDeliveries、isDeliveryActive、finishDelivery、retryDelivery、expireDelivery、consumeControlBudget、setWorkerHealth、readWorkerHealth、close。
- `enrollDevice(input: {subscription: PushSubscriptionJSON; device: {deviceId:string;deviceKey:string}; baseline:DeviceBaseline; nowMs:number}): {deviceId:string;deviceKey:string;epoch:number}`；`getDeviceStatus(deviceId:string,deviceKey:string): {enabled:boolean;epoch:number} | null`；`revokeDevice(deviceId:string,deviceKey:string,nowMs:number): boolean`。
- `readSourceCursor(source:"market"|"news"): number`；`ingestSourceEventsAndAdvanceCursor(source:"market"|"news",events:Array<{sequence:number;event:PushEvent}>,expectedCursor:number,nowMs:number): {cursor:number;enqueued:number}`；`claimDeliveries(input:{kind:"market"|"news";limit:number;leaseOwner:string;leaseMs:number;nowMs:number}): ClaimedDelivery[]`。ClaimedDelivery 为 deliveryId、deviceId、epoch、leaseOwner、subscription、event、attempts；仅 sender 内部可取得 subscription。
- `isDeliveryActive(input:{deliveryId:string;deviceId:string;epoch:number;leaseOwner:string;nowMs:number}): boolean` 在 sender 开始网络请求前检查订阅仍启用、epoch 和租约仍匹配，不需要还原或持有 deviceKey。`consumeControlBudget(input:{key:string;limit:number;windowMs:number;nowMs:number}): boolean` 只用于 API 注册和测试按钮；不约束事件发送。
- 浏览器初次开启前用 crypto.randomUUID 和 crypto.getRandomValues 生成并保存 deviceId/deviceKey，服务端只在有效登录、同源和 schema 验证后登记。enrollment 返回本设备的 deviceId、deviceKey 和 epoch；设备 key 至少 32 个随机字节，库里保存 hash，用 timingSafeEqual 验证。相同凭证、相同订阅的已启用重复请求幂等，不增加 epoch；已关闭再启用或实际订阅变更才换 epoch。endpoint 和浏览器 keys 只供内部发送使用。
- DeviceBaseline 包含各来源 lastSequence、当前异动 episode 的最高阶段、enabledAt；只有仍启用、epoch 匹配的设备参与 fanout。每个投递按 deviceId、epoch、事件/阶段唯一。
- finishDelivery/retryDelivery/expireDelivery 均接收 `{deliveryId:string;leaseOwner:string;epoch:number;nowMs:number}` 并返回 boolean；retryDelivery 另接收 nextAttemptAt:number 和安全 errorCode:string，expireDelivery 另接收 reason:string。持有旧租约或旧 epoch 不能写新状态。setWorkerHealth 接收 `{status:"disabled"|"starting"|"live"|"error";updatedAt:string;errorCode:string|null;counts:Record<string,number>}`，readWorkerHealth 返回同类型或 null。

- [x] **Step 1 写临时 SQLite 测试。** 首次及重新启用基线、不同设备互不影响、相同请求响应丢失后重复登记不增加 epoch、错 key 不能读取/修改、关闭后旧队列不能复活、原子 fanout + cursor、时间戳相同事件、重启租约恢复和过期清理。大量不同事件不因计数被丢弃。

```js
assert.equal(store.getDeviceStatus(first.deviceId, "wrong-key"), null);
assert.equal(store.getDeviceStatus(second.deviceId, second.deviceKey).enabled, true);
assert.equal(reopened.claimDeliveries({kind: "market", limit: 100, leaseOwner: "restart", leaseMs: 30_000, nowMs}).length, 8);
```

- [x] **Step 2 运行 web-push-store.test.mjs、web-push-config.test.mjs，确认新增实现缺失。**
- [x] **Step 3 实现 WAL、事务、唯一约束、租约和设备 epoch。** 控制接口的注册/测试限流记录另存，不与通知数量关联。配置关闭时不读出私钥给客户端、不清空持久队列；重新启用显式创建新 epoch。保留 episode tombstone，维护时不因删除投递日志而失去已发送基线。
- [x] **Step 4 运行以上新测试及 runtime-storage-vercel.test.mjs，全部通过。**
- [x] **Step 5 提交设备配置和队列。** 提交信息 `feat: persist per-device web push subscriptions and deliveries`。

## Task 5 Web Push sender 和后台循环

**Files:** 新增 src/lib/web-push-sender.ts、web-push-worker.ts、web-push-sender.test.mjs、web-push-worker.test.mjs、scripts/web-push-worker.mjs、scripts/web-push-worker.test.mjs；修改 package.json、pnpm-lock.yaml。

**Interfaces:**

- 安装 web-push 和对应 TypeScript 类型并锁定 pnpm-lock.yaml，不安装全球 CLI。[维护者 API](https://github.com/web-push-libs/web-push)
- `createWebPushSender(config, transport?)` 返回 `send(subscription: PushSubscriptionJSON,payload: PushEvent,options: {ttlSeconds: number; urgency: "high" | "normal"; timeoutMs: number}): Promise<SendOutcome>`。SendOutcome 为 accepted、gone、retry 或 permanent_error，并带 statusCode、retryAfterMs、安全 errorCode；不得带 endpoint 或响应原文。
- `runWebPushCycle({pushStore,marketSource,newsSource,sender,nowMs,owner}): Promise<{marketSent: number;newsSent: number;expired: number;failed: number}>`。SourceAdapter 具备 `readAfter(sequence:number,limit:number): Array<{sequence:number;event:PushEvent}>`、`getBaseline(): {lastSequence:number}`、`revalidate(event:PushEvent,nowMs:number): boolean`。marketSource 使用任务 2 的 readMarketPushEvaluation 按 episode 中的参与者键复核 latest_evaluation，不把原始 squeeze 和机会模型输入混用；newsSource 使用任务 3 事件及源缓存证据，不生成简报。两个 source 只读生产者 DB，单轮 news 是否到期读取由脚本的 60 秒计时管理。
- 无新网络采集。Sender HTTP timeout 为 10 秒；任务租约 30 秒，到期可恢复。TTL = 向下取整剩余有效秒数，若 <=0 不发送；异动 urgency high，新闻 normal。

- [x] **Step 1 写假传输及假时钟测试。** 3 个 market/1 个 news 保留槽位、最旧任务先发、同 episode 五秒内合并为最高阶段、无计数配额、取消后发送前复核 epoch、尚新鲜 pending 重启恢复。覆盖 404/410 删除订阅、429 Retry-After、5xx/超时、永久 VAPID 错误、安全日志和到期禁止重试。

```js
assert.deepEqual(fakeTransport.activeKinds.sort(), ["market", "market", "market", "news"]);
assert.equal(sent.filter(item => item.episodeId === sameEpisode).length, 1);
assert.equal(fakeTransport.callsFor(expiredEvent).length, 0);
assert.equal(disabledDeviceTransportCalls.length, 0);
```

- [x] **Step 2 运行 web-push-sender.test.mjs、web-push-worker.test.mjs，确认新发送器/循环缺失。**
- [x] **Step 3 安装局部依赖并实现 sender/cycle。** 库处理标准 aes128gcm 和 VAPID；包装器在请求之前验证 endpoint，使用库的 timeout，不跟随 redirect。429 按 Retry-After 重试，其余暂态失败用 5、15、30 秒退避，再按最长 30 秒重试到截止；加小幅抖动但不越过 expiresAt。权限关闭和 404/410 撤销设备，不把 accepted 当作“用户已看到”。脚本沿用现有环境加载与停止 helper，market 每 5 秒、news 每 60 秒读取；SIGTERM 停止领取后等待有界网络请求，不丢失已提交队列。
- [x] **Step 4 运行新增测试和市场 worker runtime 相关回归。** 使用临时运行目录执行一次脚本的未启用模式，确认没有任何外部请求、健康状态为 disabled 并保留数据库。
- [x] **Step 5 提交 sender、worker 和锁文件。** 提交信息 `feat: deliver prioritized important events with web push`。

## Task 6 登录保护 API 和当前设备控制

**Files:** 新增 src/lib/web-push-api.ts、web-push-api.test.mjs、src/app/api/push/config/route.ts、subscriptions/route.ts、test/route.ts 及相邻 route.test.mjs；修改 src/app/api/logout/route.ts、route.test.mjs。

**Interfaces:**

- `createWebPushApiHandlers({store,sender,baselineProvider,env,now})` 返回 config、getSubscriptionStatus、subscribe、unsubscribe、testPush；每个接受 Request 返回 Promise<Response>。路由只适配该服务，声明 runtime nodejs、dynamic force-dynamic，单测注入数据库与 sender。
- GET /api/push/config 返回 enabled、configured、publicKey，不回传 privateKey、subject、其他订阅。
- GET /api/push/subscriptions 使用 X-Signal-Push-Device 和 X-Signal-Push-Device-Key 请求头，返回当前设备 enabled、epoch 和 permission-independent 服务状态。
- POST /api/push/subscriptions 正文为 subscription 及当前已在浏览器生成的 deviceId/deviceKey，最多 8 KiB。成功返回当前设备凭证和 epoch；同一 endpoint 已登记但凭证不匹配返回 409。重试沿用同一正文，不再次生成凭证。
- DELETE /api/push/subscriptions 和 POST /api/push/test 必须同时有管理员登录与当前设备凭证；删除服务器订阅资格后返回 success。test 直接发送明显标注“Signal Hub 测试通知”的 payload，目标 /settings；不修改实际 episode 基线。
- POST /api/logout 保留原生表单和清 Cookie/303 回跳，在同源有效会话中，先用提交的当前设备凭证撤销服务器订阅，再完成退出；无设备凭证时仅执行现有退出行为。

- [x] **Step 1 写行为测试。** 登录保护、CSRF、伪造 forwarded host、超大正文、非法密钥/endpoint、错设备凭证、注册幂等、服务器删除成功后客户端才关闭、测试发送失败不宣称成功、退出只撤销当前设备。自然 Cookie 过期不自动撤销订阅。所有响应 private no-store。

```js
assert.equal((await handlers.subscribe(anonymousRequest)).status, 401);
assert.equal((await handlers.subscribe(crossOriginRequest)).status, 403);
assert.equal((await handlers.unsubscribe(otherDeviceRequest)).status, 403);
assert.equal((await handlers.subscribe(oversizedRequest)).status, 413);
assert.equal(JSON.stringify(await configResponse.json()).includes(privateKeyFixture), false);
```

- [x] **Step 2 运行 web-push-api.test.mjs 与新增 route.test.mjs，确认行为缺失。**
- [x] **Step 3 实现会话、同源及当前设备校验。** 校验真实 Origin 与规范站点 origin；反代环境优先使用部署明确设置的公共 origin，不将任意 x-forwarded-host 直接信任为许可 origin。控制 API 注册最多 10 次/分钟、测试最多 3 次/分钟，以持久当前设备或登录来源键计算；这些限制不得用于事件发送。所有客户端错误用稳定错误码，未知错误不回传内部原文。
- [x] **Step 4 运行新增 API 测试及 proxy.test.mjs、admin-auth.test.mjs、api/logout/route.test.mjs、api/login/route.test.mjs。** public/sw.js 和图标应能在 Cookie 到期后继续加载，其他私有路径保护不变。
- [x] **Step 5 提交 API 和退出当前设备处理。** 提交信息 `feat: secure current-device push enrollment and controls`。

## Task 7 浏览器通知设置和 Service Worker

**Files:** 新增 public/sw.js、src/lib/web-push-client.ts、web-push-client.test.mjs、src/components/important-push-settings.tsx、important-push-settings.behavior.test.mjs、src/lib/web-push-service-worker.test.mjs；修改 src/app/settings/page.tsx、src/components/app-shell.tsx、src/components/market-alerts-panel.tsx、daily-brief-panel.tsx。

**Interfaces:**

- `getPushEnvironment(): {supported:boolean;needsHomeScreen:boolean;permission:NotificationPermission|"unsupported"}` 使用特性检测、secure context 和 iOS standalone 检测，不因普通 UA 自报支持就开启。
- `createWebPushClient(api?,browser?)` 提供 `readStatus()`、`enableFromUserGesture()`、`sendTest()`、`disable()`、`getLogoutFields()`。凭证只留当前浏览器存储，分别读取/更新一组 key signal-hub:push-device:v1。
- ImportantPushSettings 只消费 client 服务，不嵌入密钥、路径或后台实现说明。状态为加载、不可用、需主屏幕、未配置、权限拒绝、可开启、开启中、已开启、关闭中、失败。
- Service Worker 接受 PushEvent 的安全显示字段；target 只允许本站 /alerts、/intel、/settings（含安全 query/hash）。异动 target `/alerts?symbol=SYMBOL#market-push-SYMBOL`，新闻 `/intel#news-push-EVENT_ID`；对应面板添加稳定定位标识，不改变列表或排序规则。

- [x] **Step 1 写浏览器 mock 和 worker VM 测试。** 初次加载不会索要权限；iPhone 普通标签页显示主屏幕指引，standalone 与 API 支持才启用。拒绝权限、浏览器 subscription 已有但服务器状态丢失、register 失败、服务器撤销失败都呈现正确状态。稳定 tag 去重、点击 focus/navigate 优先、无窗口 openWindow、恶意 target 回退本站、没有 fetch 私有缓存。

```js
assert.equal(fakeBrowser.permissionRequests, 0); // 首次读取
assert.equal(getPushEnvironment().needsHomeScreen, true); // 此测试预设 iOS 普通标签页环境
await client.disable();
assert.deepEqual(callOrder, ["server-revoke", "browser-unsubscribe"]);
assert.equal(notificationOptions.tag, `signal-hub:${episodeId}`);
```

- [x] **Step 2 运行 web-push-client.test.mjs、web-push-service-worker.test.mjs、important-push-settings.behavior.test.mjs，确认功能缺失。**
- [x] **Step 3 实现用户点击触发的开启流程及设置页分类。** readStatus 提前读取配置并准备 SW；准备完成前保持按钮 loading。按钮手势直接请求 iOS 权限，之前不得 await 注册或网络。先保存生成的设备凭证，再发订阅请求；网络结果不明时用同一凭证查询状态或重试同一正文，不错误显示开启成功，也不生成第二设备。browser permission granted 也须核实服务器订阅与 VAPID key；key 轮换需要重新订阅和基线。关闭先服务端再浏览器。app-shell 的 POST logout form 加当前设备隐藏字段，未启用时维持现有表单。说明 Cookie 到期后继续通知及锁屏内容；加入 Windows 后台运行和 iPhone 主屏幕操作指引。通知 JSON 损坏时显示不含敏感信息的通用提醒，避免 iOS 接收到 push 却没有可见通知；不执行素材里的代码或指令。若目标币种不在当前分页，仍进入异动页并明确显示该币种引用，不假装定位到别的条目。
- [x] **Step 4 运行新测试及 src/app/settings/settings-health-tab.test.mjs、src/app/manifest.test.mjs、public/pwa-assets.test.mjs、src/lib/app-shell-navigation.test.mjs、src/app/api/logout/route.test.mjs。** 在本地浏览器检查桌面和手机宽度，通知状态操作键盘可达，主题一致，不阻塞网站消息更新。
- [x] **Step 5 提交浏览器入口、worker、定位和测试。** 提交信息 `feat: add background notification controls for Chrome and iPhone`。

## Task 8 部署健康及回滚

**Files:** 修改 src/lib/system-health.ts、system-health.test.mjs、signal-hub-services.ts、scripts/deploy-vps.sh、deploy-vps.test.mjs、deploy-vps.integration.test.mjs、scripts/check-deployment.mjs、package.json、.env.example；新增 docs/important-background-push.md、scripts/web-push-deployment.test.mjs。

**Interfaces:**

- 增加 signal-hub-web-push 服务和 scripts/web-push-worker.mjs；package scripts 为 push:worker 和 push:worker:once，沿用 Node strip/transform flags。
- SystemHealthItem 增加 id web-push，元数据只含安全状态和计数；disabled 为非故障，enabled 且配置错误/连续认证错误为 error，心跳超过 30 秒为 stale warning。
- .env.example 仅加空 VAPID 字段及 WEB_PUSH_ENABLED=false；公共 origin 若需反代规范化，使用 SIGNAL_HUB_PUBLIC_ORIGIN，只有合法 HTTPS 生产 origin 才接收订阅。
- 文档给出两设备操作、生成并妥善保留 VAPID 的方式、当前设备退出策略、数据库备份和验证命令；不要把实际密钥打印到聊天或提交库中。

- [x] **Step 1 写 disabled、invalid、stale 和回滚测试。** 初次发布的新 service 不存在时创建，数组与 script 一一对应；旧 release 没有 push script 时先 stop 新服务再 restart 旧有服务。关机重启与发布保留 .signal-hub 数据；健康和部署 readiness 不因明确 disabled 功能失败。日志没有 endpoint、deviceKey 或 privateKey。

```js
assert.equal(disabledPushHealth.status, "ok");
assert.equal(invalidPushHealth.status, "error");
assert.equal(rollbackLog.includes("restart signal-hub-web-push"), false);
assert.equal(readFileSync(runtimeMarker, "utf8"), "preserve runtime");
```

- [x] **Step 2 运行 web-push-deployment.test.mjs、deploy-vps.test.mjs，确认新服务规则缺失。**
- [x] **Step 3 集成可选服务、心跳和回滚。** 不因配置缺失令其他采集服务无法启动；部署时对推送是否启用采用明确环境开关。回滚按旧 release 中实际存在的 worker 清单重启，不把新版本全部 service 无条件送入旧版。任何密钥生成和真实服务器配置保留到代码可审阅及用户授权的上线步骤。
- [x] **Step 4 运行 system-health.test.mjs、deploy-vps.test.mjs、web-push-deployment.test.mjs；在 Linux 隔离 fixture 中运行 deploy-vps.integration.test.mjs。** 2026-10-03 在 VPS 的独立临时目录执行完整 Linux fixture 与便携回滚状态测试通过，所有 systemd 操作使用替身。Windows skip 未计为 Linux 通过。
- [x] **Step 5 提交健康、部署和用户文档。** 提交信息 `feat: deploy and monitor the background push worker`。

## Task 9 全链路验收和交付

**Files:** 新增 e2e/important-push.spec.ts；按失败或反馈修改相关功能文件；更新 docs/important-background-push.md 中验收结果。

**Interfaces:** 不增加新的业务接口，使用任务 6 的 API、任务 7 的设置控件和 worker，再从任务 2、3 注入已批准的测试事件。

- [x] **Step 1 写浏览器与发送循环的集成用例。** 独立 SIGNAL_HUB_RUNTIME_DIR、MARKET_ALERTS_DB 和本地生成的测试 VAPID。先为浏览器授予通知权限，真实注册本地 SW；用 test-only initScript mock PushManager.subscribe/getSubscription，返回本地生成的有效 p256dh/auth，避免真实 FCM enrollment。Playwright 拦截控制 API 调用并转交任务 6 的 createWebPushApiHandlers，注入临时 store、测试 env 和 fake sender；真实 Next 路由的登录和同源保护另由任务 6 测试覆盖，生产代码不增加测试后门。登录后开启、关闭、测试、退出及再次登录。独立集成测试通过任务 2、3 的事务 producer 写入有效异动、普通异动、过期信号、重大新闻和旧新闻，再调用真实 runWebPushCycle 加 fake sender，检查资格、顺序和无条数上限。

```ts
await expect(page.getByRole("button", { name: "开启通知" })).toBeVisible();
await expect(page.getByText("通知已开启", { exact: true })).toBeVisible();
expect(eligibleMarketDeliveries).toHaveLength(8); // 无三条上限
expect(duplicateEpisodeDeliveries).toHaveLength(1);
```

- [x] **Step 2 补上关闭页面后的 SW 行为验证。** 保留同 browser context 的 about:blank 辅助控制页及其 CDP session，先监听 workerRegistrationUpdated，再启用 ServiceWorker 域；按精确 scopeURL 和未删除状态记录 registrationId，并确认对应版本 activated。关闭所有网站页面，保持控制页及浏览器运行，再用 [ServiceWorker.deliverPushMessage](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/) 注入测试 payload。重新打开同源页面读取 registration.getNotifications，检查内容、tag 与 data 中点击目标；保留真实 showNotification，不用 spy 替换。执行时核实当前 Chrome 是否支持该实验 CDP 方法；缺少支持时记录这一验证缺口。此测试证明没有网站窗口时 SW 能处理模拟 push，不等同于 Google/Apple 到设备的真实投递，也不证明系统桌面已经显示。
- [x] **Step 3 先构建隔离测试服务器，再运行定向 E2E。** 当前 Playwright webServer 使用 next start，因此先指定独立 SIGNAL_HUB_RUNTIME_DIR、MARKET_ALERTS_DB、WEB_PUSH_ENABLED=false、NEXT_TELEMETRY_DISABLED=1 运行 `pnpm build`，然后 `pnpm exec playwright test e2e/important-push.spec.ts`。API harness 的测试 env 允许明确 localhost origin，生产部署仍要求 HTTPS。浏览器依赖不可用时报告缺口，不能用静态测试代替。
- [x] **Step 4 完成项目最终检查。** 2026-10-03 整合 GitHub 后续更新后的发布版本，271 个测试文件、lint、TypeScript、生产构建及五个 Chrome 用例通过；实际 Linux 上的完整发布回滚 fixture、Bash 语法和便携回滚状态测试通过。
- [x] **Step 5 进行一次独立整分支审查并修复有效发现。** 检查授权、安全 endpoint、基线、阶段去重、来源时间、发送前失效、优先级和回滚。五项重要问题已在单次修复阶段中以 RED→GREEN 验证；新增完整来源时间、硬中止期限、新闻归档定位和回滚持久停用。没有延期小问题。
- [ ] **Step 6 在具备 HTTPS 和生产配置的站点验证真实两个设备。** 用户分别亲自开启浏览器权限，Windows 保持 Chrome 进程运行但关闭网站标签页；iPhone 从主屏幕打开启用后关闭应用。两端都实际收到一次测试通知和一次可控的重要事件，点击返回正确位置。记录提供商 accepted 与实际显示的区别。没有设备确认时只能标注“代码/模拟验证完成，实机待验证”。
- [x] **Step 7 交付可审阅代码及检查结果。** 代码、设备/服务器操作文档及独立审查验收记录保存在隔离分支；未上线、未创建 PR，生产配置与真实两设备验收待执行。用户选择本地合并、推送 PR 或保留分支后执行对应集成；创建 PR 后始终附加到当前聊天。

## 执行方式建议

建议由主代理在当前聊天逐项实现，最后由独立代理审查整个分支。事务 outbox、episode 和设备 epoch 的接口相互依赖，连续实施更容易保持一致；只读调查和最终审查仍可委派。另一选择为逐任务子代理实施并逐任务独立审查，复核更密集，但会增加任务交接和上下文开销。

用户审阅本计划并选择执行方式后，才能调用相应执行技能开始产品代码。计划保存本身不代表依赖已安装、测试已运行或功能已经上线。
