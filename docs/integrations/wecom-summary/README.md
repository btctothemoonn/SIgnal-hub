# 企业微信群总结接入 SignalHub：对接规范 v2

更新：2026-09-07。Windows 网站接收端已实现，原合成验收记录见 [Windows 回执](./WINDOWS-RECEIVER-RECEIPT.md)。**用户现已授权部署和真实同步，并明确要求企微总结免密码查看。** 本轮部署状态及 Mac 启用方式记录在 [上线交接](./PRODUCTION-ACTIVATION.md)，历史合成回执不代表当前上线状态。

本轮实施依据 Mac [bcb544a 的接入交接](https://github.com/btctothemoonn/wecom-summary/blob/bcb544a746dac7f2b7c55476eb5ec66672d1113f/docs/integrations/signalhub-v2-connect-handoff.md)，对应已发布功能 `d9ddae971bf98d4340e4a67da3cda25513dcae99`。接受市场样例计数修正为 `uniqueStatementCount=2 / duplicateCount=0`；[8f6df4f 历史材料](./history/8f6df4f/manifest.json)保留原字节与哈希，不再用其旧 `1/1` 计数作为来源语义基准。

本规范对齐 Mac [dc259a93ab41a8b00f64a638a5a3ab0c762ffb95](https://github.com/btctothemoonn/wecom-summary/commit/dc259a93ab41a8b00f64a638a5a3ab0c762ffb95) 的[设计](https://github.com/btctothemoonn/wecom-summary/blob/dc259a93ab41a8b00f64a638a5a3ab0c762ffb95/docs/superpowers/specs/2026-09-06-signalhub-sync-design.md)与[实施计划](https://github.com/btctothemoonn/wecom-summary/blob/dc259a93ab41a8b00f64a638a5a3ab0c762ffb95/docs/superpowers/plans/2026-09-06-signalhub-sync.md)。已完整阅读两份文件并核对该提交的 briefing 校验代码。该提交位于 `codex/wecom-notification-probe`，不是 Mac `main`，也不能据源码推断运行进程版本。

本文件取代 [55dfa50 的 v1 文档](https://github.com/btctothemoonn/SIgnal-hub/blob/55dfa500c37d550721a9c1aec0f71e9e6496cc90/docs/integrations/wecom-summary/README.md)。旧样例不可继续用于 v2。参见 [不兼容项与实施缺口](./V2-COMPATIBILITY.md)。

## 1. 范围与隐私

- 独立页面 `/wecom` 展示完整群聊总结、来源元数据、实时“跨群提及”CA 卡片及设备状态，不混入 X/TG 或市场简报。
- **保留用户已授权的群名、昵称、观点归属和来源元数据**；不默认匿名化、删除名字或压平完整总结。
- **不上传原始聊天、逐条内容、引用原文、附件、通讯录、成员列表、源库文件或平台事件 ID。** `sources` 必须是空数组；`sourceReferences` 没有 content/excerpt 等正文键。
- 总结中保留既有结论和说话人归属，不把原文粘贴到 summary/note 绕过限制。只允许最终版总结，不输出模型思考过程。原 CA 字符串不是凭证，不能因长度或混合大小写被误删。
- 不上传 MiniMax Key、LAN 密码、同步 secret、provider_request_id、token 用量或诊断对象。疑似凭证/核心正文超限时隔离整份结果并记固定错误码，不静默删结论或引用。
- 本轮已授权开启发送、配置专用凭证和部署；没有要求历史回填或重新生成 AI 总结。原监听、群配置、relay 边界、2h/6h/24h 调度及源数据库保持不变。

## 2. 授权边界

默认模式下，所有页面、报告列表/详情、CA 历史/活跃列表和设备状态都先验证**登录会话和该设备数据的访问授权**。用户明确授权的公开模式使用 `WECOM_PUBLIC_READ=true`：仅精确 `/wecom`、`/api/wecom/reports`、`/api/wecom/ca-alerts`、`/api/wecom/status` 的 GET/HEAD 免登录，内容（含群名、昵称、CA、设备状态）可由知道地址的访客查看。其他页面、其他方法、子路径和未来新增接口不自动开放。HMAC 写入凭证不变，也不成为读取凭证。

当前 Signal `src/lib/admin-auth.ts` 是单管理员会话，没有 userId/多账号 ACL。默认私有模式要求本人独占管理员空间；用户明确选择公开模式时不作私有承诺。两种模式都由服务器绑定 owner 与 device；客户端不能自报 owner 或设备来访问其他数据。未来多用户时需要真实身份与设备归属授权，不能将当前单管理员模式当作多用户 ACL。

默认私有模式下，匿名 API 返回 401；登录但无设备权限返回 403；页面未登录跳转登录页。公开模式不校验登录，但仍只读取服务器绑定的设备，伪造设备选择返回 403，不能跨设备。页面/读 API 均做服务端访问判定，不依赖客户端检查。公开开关关闭后重新恢复私有规则；401/403 仍清空前端数据。

所有带内容或设备状态的响应使用 `Cache-Control: private, no-store`；不进公共 CDN、静态构建、公开日志或共享 Service Worker 缓存。服务器独立 SQLite 是私有持久缓存，断网仍可在登录授权后读取；浏览器只保留当前授权会话中的内存副本。

## 3. 传输与端点

| 目标端点 | 约定 |
| --- | --- |
| `POST https://holdrich.online/api/wecom/ingest` | 唯一机器写入口；HMAC；接受 v2 report / ca_alert / heartbeat |
| `GET /api/wecom/reports?cadence=two_hour&limit=10&before=...` | 授权后，周期分页摘要 |
| `GET /api/wecom/reports?id=...` | 授权后，完整结构化报告 |
| `GET /api/wecom/ca-alerts?limit=10&before=...` | 授权后，CA 历史分页 |
| `GET /api/wecom/ca-alerts?active=1&limit=50` | 授权后，当前有效卡片与总量 |
| `GET /api/wecom/status` | 授权后，设备/通道状态；与列表中的 status 同结构 |
| `GET http://127.0.0.1:3041/health` | 仅 VPS 内部最小存活检查，不返回设备状态、配置或数据，不反向代理到公网 |

只有精确 POST 写入口可免除网页登录跳转，同时强制 HMAC；该路径的 GET/其他方法、子路径不因写入口豁免而变公开。读取是否免登录由独立公开开关决定。写凭证仅能向服务器绑定的设备写入，验证 body ID 的设备/store 前缀，不能冒充另一设备。启用前核对 [上线交接](./PRODUCTION-ACTIVATION.md) 的实际部署状态。

HTTP 正文为 UTF-8 JSON，无压缩，最多 **262144 字节**；不跟随重定向、不跳过 TLS、不允许 URL 中携带凭证。未知字段、未知类型、未知版本、无效 Unicode、控制字符（除 TAB/LF/CR）拒绝。JSON 对象不允许重复键；布尔不能替代整数，所有计数是 0 至 9007199254740991 的整数。

### 签名保持 v1

必填头：`X-Wecom-Device`（1-64 位，`[A-Za-z0-9][A-Za-z0-9._-]*`）、`X-Wecom-Timestamp`（10 位 Unix 秒）、`X-Wecom-Nonce`（随机 16 字节的 32 位小写 hex）、`X-Wecom-Signature`（64 位小写 hex）。secret 至少 32 字符，建议随机 32 字节的 64 位 hex 文本；HMAC 使用该文本的 UTF-8 字节，**不进行 hex 解码**。

以下六行由 LF 连接，末尾无 LF，使用 HMAC-SHA256：
```text
POST
/api/wecom/ingest
{deviceId}
{timestamp}
{nonce}
{sha256(实际发送的 body 字节)，小写 hex}
```

时间容差 300 秒；接受 nonce 持久保存至少 610 秒，与对象/心跳写入同一事务，重启后仍拒绝重放。重试更新 timestamp/nonce/signature，但固定原 payload 字节。Mac 规范序列化沿用其计划：`ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")`，再 UTF-8 编码；接收端直接验实际字节，不重排 JSON 后验签。

[signature.example.json](./signature.example.json) 含三种类型的公开离线向量，`body` 是确切签名字符串。固定时间和公开测试 key 只能用于离线测试，禁止作为生产配置。

Mac 私密配置含 `url/deviceId/secret`，通过 `--config` 指定；当前已发布代码默认 `~/Library/Application Support/wxFomo LAN/signalhub-sync/config.json`。目录 0700、文件 0600，验证所有权，拒绝符号链接/硬链接。不修改原目录权限。VPS 使用非公开 `WECOM_SYNC_DEVICE_ID/WECOM_SYNC_SECRET`，可选 `WECOM_RECEIVER_PORT=3041`；禁止 `NEXT_PUBLIC_` 或将密钥写入 Git。

三个**服务器开关，不是上传字段**均默认关闭：`WECOM_SYNC_ENABLED=true` 才接收；私有模式需要 `WECOM_OWNER_ADMIN_ONLY=true` 加合法管理员会话；用户授权公开时设置 `WECOM_PUBLIC_READ=true`，仅上述既定读取免登录。两种读取模式均绑定服务器设备。关闭写入不删除已收数据。公开读取也返回 `private, no-store` 和不索引提示，不把内容放进共享缓存。

## 4. report v2

封装严格为 `{schemaVersion:2,type:"report",report:{...}}`。`schemaVersion` 是传输版本，`briefing.version` 是内部总结版本，独立校验，不能相互替代。

| 字段（全部必填） | 规则 |
| --- | --- |
| id / revision | id 最多 1024，`[A-Za-z0-9][A-Za-z0-9._:-]*`；`wecom:{deviceId}:{storeId}:{sha256(job_id UTF-8)}`。revision 为成功结果 analysis_id，正安全整数 |
| cadence | two_hour / six_hour / daily |
| windowStart / windowEnd / generatedAt | UTC ISO 8601；推荐毫秒格式，起点 < 终点；生成时间取 result.created_at，不取任务创建/同步时间 |
| summary / model | 非空，最长 10000 / 256 UTF-16 单位。summary 只是 quick_read 三条预览，不是完整正文 |
| sourceCount / sourceComplete | 冻结输入数量；完整性只针对本地冻结记录，不保证采集了完整群聊 |
| sourcesTruncated / sources | `sourcesTruncated = sourceCount > 0`，`sources = []`；表示不分享原文，**不表示 briefing 被截断** |
| topics / findings | v2 均固定 []，不能退回 v1 从这里读完整结论 |
| caDiscussions | 报告窗口的 CA 聚合，最多 50 项，格式见第 6 节 |
| briefing | 下节完整结构，不能压平、补写或调用 AI 重做 |
| scope | 严格字段见下文 |
| sourceReferences | 实际引用的元数据并集，最多 500 项，无原文 |
| caCoverage | `{sourcesComplete,totalItems,exportedItems,truncated}` |

storeId 首次启用时持久化，重启不重建。结果代际回退/替换须暂停对应通道并审阅，不拿 worker instance_id 当库代际。已知源库恢复需先停用同步再建立新 storeId；现有锚点检测不能保证识别所有相同锚点的备份恢复。

### scope 与来源闭包

scope 仅有：
`groupNames, timeZone, timeBasis, dataCutoff, frozenCount, analyzedCount, readableCount, missingCount, unknownTimeCount, completeChatHistory, externalVerification`。

- groupNames 是可读冻结记录的群名集合，最多 50 个、每个最多 200 UTF-16 单位，不猜不可读来源的群名。不静默裁群；真实范围超限时隔离并反馈。
- timeZone 固定 Asia/Shanghai，timeBasis 固定 notification_observed_at。dataCutoff 是读取记录中最新采集时间，UTC 或 null。
- `frozenCount = analyzedCount = sourceCount`；`readableCount + missingCount = frozenCount`；`unknownTimeCount <= readableCount`。
- sourceComplete 与 caCoverage.sourcesComplete 均基于是否能匹配完整冻结输入；缺失记录时为 false。`completeChatHistory = externalVerification = false`，不冒充完整群聊或外部核验。
- caCoverage 的 exportedItems 等于 caDiscussions.length；totalItems 是可读冻结输入中裁剪前聚合总数，至少 exportedItems；truncated 等于 exportedItems < totalItems。完整性与展示裁剪是两个独立维度。

sourceReferences 每项严格为 `{id,group,sender,observedAt,available}`：
- id 是按冻结顺序映射的报告内编号 `M0001` 等，匹配 `M[0-9]{4,}`、最长 32；不是平台事件 ID。编号唯一，不能按引用发现顺序重新编号。
- group/sender 是群名/昵称或 null，最长 200 UTF-16 单位；observedAt 为 UTC 或 null，标注“通知采集时间”而非发言时间。
- available=false 时上述三项均为 null。可读来源缺少昵称/时间仍可 available=true，缺失项用 null；不能伪造来源。
- 所有 briefing.source_message_ids 和 caDiscussions.sourceMessageIDs 都必须解析到本报告的元数据。元数据集合必须恰好是实际引用并集，不能夹带其他消息身份。
- 缺失原记录仍保留被引用编号和缺口；没有正文就显示“原文仅保存在 Mac，未同步”，不提供假“查看原文”。

源库暂时不可读应重试，不能当空库；可读但确实缺失时可保留原总结并标不完整。scope 缺口计数涵盖全部冻结输入，不只是实际引用的子集。

## 5. 完整 briefing

与 Mac dc259a9 的 `briefing.py:validate_briefing` 对齐。所有对象严格字段白名单，数组必填、不能 null：

| 对象 | 精确字段与限制 |
| --- | --- |
| briefing | version=2、kind=market/business、quick_read、projects、events、gaps、business |
| NOTE | text、source_message_ids |
| quick_read | focus/news/risk，均为 NOTE |
| project（最多 8） | name、chain、summary、catalysts、latest、risks、data、addresses、source_message_ids |
| data（每项目最多 4） | value、unit、source、recorded_at、kind、source_message_ids；kind=历史快照/个人预测，其余标量为原有字符串 |
| address（每项目最多 1） | address、chain、source_message_ids；chain 等于项目 chain；32-44 个 ASCII 字母数字，原样保留 |
| event（最多 10） | event、asset、nature、impact、pending、source_message_ids；nature=自述/转述/推测/待核实 |
| gaps（最多 8） | NOTE 数组 |
| business | progress/notices/blockers 为 NOTE 数组；tasks 为 task 数组，每数组最多 10 |
| task | text、owner、deadline、source_message_ids |

每处引用最多 5 个本地编号；实质结论必须引用。仅 quick_read 的“无有效信息”/“未提供”可用空引用。未知信息沿用“未提供/待核实/未确认”，不能编造负责人、日期、链或证实结论。market 的 business 四数组为空；business 的 projects/events 为空。快照中的 recorded_at 是来源原有记录口径，不强行当作机器 UTC 时间解析。

Mac 先在本地按原规则验证正文（最多 600 个 Python 字符、实际地址证据和引用），再仅映射引用字段。v2 briefing 文本传输上限 **1200 UTF-16 单位**，无损容纳补充平面字符；不将此限制误套 group/sender 或旧字段，也不能把 600 个普通字符上限放宽成 1200 个普通字符的模型输出。

Signal 不拥有原文，能校验结构、引用闭包和计数，**不能独立证明总结或 CA 获原文支持**；证据核对由 Mac 完成。不因元数据 available=true 就标“已核验”。正文中的 HTML/脚本仅作安全文本，禁止执行。

优先保留核心 briefing 和其必要元数据。仅可从已排序可选 CA 卡尾部减少条目以满足 500 引用/256 KiB 上限，记录 coverage；留下的卡片计数不改。核心本身超限则隔离整份，不偷偷删结论、姓名或引用。

## 6. 报告 CA 与实时 CA 分离

报告 caDiscussions 项继续使用：
`{address,network,groups,mentionCount,uniqueStatementCount,duplicateCount,summary,sourceMessageIDs}`。
address/network 最长 128/40；groups 最多 50、每项 200；summary 最长 2000 或 null；引用最多 5。所有计数为非负安全整数，`mentionCount = uniqueStatementCount + duplicateCount`。报告 CA 可有 unknown 网络，但未知 EVM 按群隔离，不强行跨群合并。

报告 CA 只对每份新成功结果的完整冻结范围聚合一次并固化；重试不重算。显示地址取直接来源中首次原样字符串，匹配键可规范化，显示值不可随之改大小写；无证据恢复原样时隔离导出。昵称不等同真实身份，重复搬运不等于独立证实。

network 使用 dc259a9 现有规则的规范值：base/bsc/ethereum/arbitrum/polygon/optimism/avalanche/solana（报告另允许 unknown）；它与 briefing 中原样 chain 文本、原样地址的大小写规则不同。

### ca_alert v2 字段

封装严格为 `{schemaVersion:2,type:"ca_alert",alert:{...}}`，alert 字段全部必填：

| 字段 | 规则 |
| --- | --- |
| id / revision | `wecom-ca:{deviceId}:{storeId}:{持久 episode 序号}`；同活跃期 ID 稳定，revision 正安全整数、持久单调增加 |
| address / network | 原样 CA，最长 128/40；network 是现有文本规则识别值，实时跨群不允许 unknown，不访问链上或行情服务 |
| groups / groupCount | 不重复群名数组，2-50 群、每项 200；groupCount 等于长度，不静默裁群 |
| mentionCount / uniqueStatementCount / duplicateCount | 非负安全整数，mentionCount=uniqueStatementCount+duplicateCount；同事件只计一次，不拿刷屏条数代替群数 |
| firstSeenAt / lastSeenAt | 最后有效窗口统计的采集时间范围 |
| triggeredAt / evaluatedAt / expiresAt | 首次满足条件的检测时间 / 本版计算时间 / 跨群条件预计失效时间，全部 UTC |
| windowSeconds / thresholdGroups | 首版固定 3600 / 2，冷却规则为 1800 秒 |
| status | active/expired；expired 沿用最后有效快照的群、计数、firstSeenAt/lastSeenAt/expiresAt，只更新状态、revision、evaluatedAt |
| notificationVersion | 非负安全整数且 <= revision；本规则仅 0 或 1，同 episode 不变。正常首次通过冷却为 1；冷却抑制或 catchup 为 0 |
| catchup | 首次形成于停机/积压追赶则 true，同 episode 保持不变，网页不弹实时新提醒 |

active 满足 firstSeenAt <= lastSeenAt <= evaluatedAt、triggeredAt <= evaluatedAt、evaluatedAt < expiresAt；过去窗口边界 `(evaluatedAt-3600秒,evaluatedAt]`。expired 可能由合法消息修订/归并导致早于预计 expiresAt 关闭，因此**不能强制 expired.evaluatedAt >= expiresAt**。服务器按显式 expired 或当前时间 >= expiresAt 视为失效；关闭后不接受同 episode 重新 active，重新触发应新建 ID。

提醒仅称“跨群提及”，不是投资机会或事实核验。CA payload 不含昵称列表、消息内容、原始事件 ID、源库路径或 AI 摘要。

### 触发、冷却与追赶

- Mac 每 10 秒有界读取新消息。60 分钟内至少 2 个不同已配置群、同链同 CA 才触发；未知 EVM 按群隔离，可能漏掉未注明链的讨论，页面如实说明。
- 用 messages.id 插入序号推进，observed_at 用于窗口、inserted_at 用于本地延迟度量；不能用采集时间当游标。原位 record_version 修改/别名归并/删行需每 60 秒分批核对滚动索引，触发前复核候选直接来源。
- EVM 内部键小写、Solana 原样；同昵称+归一化相同文本的搬运记重复，无昵称按事件键处理，不宣称独立人数。
- expiresAt = 各群最近有效采集时间中第二新的时间 + 3600 秒，不是全局 lastSeenAt + 3600 秒；无新消息也要评估过期。
- 同 episode 只更新卡片。失去第二个有效群关闭，重新达到阈值新 episode；同键 30 分钟内不再发站内新提示，但保留卡片。冷却结束本身不重弹，单纯重复搬运不反复弹。
- 网络断开时已经检测入队的事件原样补传，过期/延迟展示，不冒充刚触发。停机未检测的过期窗口只计漏检、不编造历史提醒；重启追赶水位内或处理延迟 >60 秒派生的新 episode 为 catchup=true。
- 正常联网、无积压、页面可见时，目标为采集入库至网页可见 <=60 秒，**不是 SLA，也不是从实际发言时间起算**。Mac 本地插入时间、检测时间和网站接收/显示时间用合成联调独立测量，不能用 HTTP 200 代替。

## 7. 设备状态与读响应

heartbeat 封装 `{schemaVersion:2,type:"heartbeat",status:{...}}`，status 精确八字段：
`listener,worker,pendingReports,lastError,caDetector,pendingAlerts,lastMessageObservedAt,lastCaEvaluatedAt`。
三进程状态为 online/offline/unknown；两个 pending 为安全整数、报告和 CA 分开；两个时间为 UTC 或 null。lastError 为 null 或 `[a-z][a-z0-9_]{0,79}` 固定码，不能放原异常。

监听/worker 使用真实心跳（Mac 当前 5 秒/15 秒判定）；CA 超过 30 秒无成功评估为 offline，源不可读为 unknown；不能用 AI/HTTP 成功推断 CA 在线。设备连接超过 180 秒无有效请求为 offline，最后报告仍可读取。待确认与隔离队列不可通过假“0”隐藏错误；隔离/积压至少通过固定错误码明确标记。

服务器读 status = 八个心跳字段，加 `configured,connection,lastSeenAt,lastReportAt`，connection 为 waiting/online/offline，其余时间 UTC 或 null。未收到心跳时进程均 unknown。即使仍返回上次进程证据，connection=offline 时网页必须整体标“状态已过时”，不把旧 online 当实时。

报告列表返回 `{items,nextCursor,status}`；每项是 v1 的简版字段 id/cadence/windowStart/windowEnd/generatedAt/summary/model/sourceCount/sourceComplete/sourcesTruncated，另加 syncedAt；summary 预览最多 450 UTF-16 单位。按 `(windowEnd DESC,id DESC)` 分页，limit 1-10。详情返回 `{report,syncedAt}`，report 是完整 v2 对象，不能只回 summary。

CA 历史返回 `{items,nextCursor,status}`，按 `(triggeredAt DESC,id DESC)` 分页，limit 1-10；active 模式 limit 1-50、不得同时 before，返回 `{items,nextCursor:null,status,total,truncated}`，total 是**已授权**有效卡片总量，truncated=items.length<total。每项为 alert 全字段加以下**仅服务器读取字段**：
- firstReceivedAt：该 typed ID 第一次持久收到的服务器时间，不随后续修订变化。
- syncedAt：当前存储版本的接收时间，不覆盖源时间；duplicate/stale 不刷新版本时间。
- effectiveStatus：服务器依据 status/expiresAt 计算的 active/expired。
- delayed：首次接收相对 triggeredAt >60 秒；不与 catchup 混用，不代表完整入库至网页耗时。

上述读字段不允许出现在 Mac 上传的 alert。跨类型分开存储，episode 新修订不能重设 triggeredAt/catchup/notificationVersion/firstReceivedAt。乱序低版本不得覆盖高版本，关闭版本先到时旧 active 不得复活。

所有查询严格校验枚举、整数、重复参数、游标及组合；before 为不透明游标、不能用于跨设备越权。不存在且已授权的详情返回 404。正文按需读取；列表不开完整来源数组。

CA 当前可见区每 15 秒刷新，总结每 60 秒；隐藏时停、重开立即加载。浏览器按 `(id,notificationVersion)` 去重：首次进入只展示，后续仅对 notificationVersion>0、catchup=false、未过期、且首次接收距离 triggeredAt <=60 秒的未提示事件发站内提示。重新打开不批量弹历史。退出登录清缓存；网络异常保留本会话上次成功结果。首版不申请系统通知、邮件、Telegram 或后台 Web Push。

## 8. 持久确认、限流与独立资源

report/ca_alert 成功均回显 `{ok:true,id,revision,disposition:"stored"|"duplicate"|"stale"}`；heartbeat 成功为 `{ok:true}`。必须在持久提交后才返回。Mac 校验 HTTP 200、合法 JSON、匹配当前 type 对应的 id/revision 和 disposition 才出队；type 由固定请求上下文关联，不修改 v1 确认格式。响应读取最多 16 KiB。

同 type+id+revision 同字节为 duplicate；同版异内容 409 revision_conflict；低版本 stale 回显请求版本、高版本才可更新。数据库键至少包含 owner/device/type/id；队列键包含 type/id/revision，不共用无类型 ID。重放 nonce 409 replay；不修改未确认 payload 绕过冲突。

401 全局暂停；429 解析 Retry-After（秒或日期，最长 900 秒）；404/405、503 sync_unconfigured 低频探测；408/5xx/断网指数退避 5 秒到 300 秒并抖动；400/413/415/revision_conflict 持久隔离，不丢弃或无限阻塞其他合法数据。未知版本 400 unsupported_schema 后暂停该版本通道并回报，不降级成残缺 v1。错误只回固定码、不回堆栈或私密内容。

Mac 使用只读源连接、独立同步库和双水位；payload+对应游标+最小 CA 状态同事务保存，确认单独持久化。报告每60秒最多10份；CA每轮最多500行或2秒；滚动复核每批500行。新鲜CA最多连续3个后给到期报告机会，心跳60秒，不绕过全局暂停。报告计算不占用CA循环，发送一次一个请求、超时10秒。

队列（含隔离）上限1000条或128MiB，滚动索引额外32MiB；达限暂停对应读取并报错，不删未确认事件。过期索引可清理，但其未确认payload不得删除。源库坏行可定位隔离，不静默越过；原库与relay不写。

VPS 独立127.0.0.1:3041接收器、独立SQLite，部署脚本设置192MiB内存/25%CPU、8并发/16连接、正文/转发3秒；数据库含WAL预算256MiB。达限503让Mac保留队列，不共用主信号流写锁。持续负载指标仍须实测，不声称零影响。

用户现已明确确认首次启用：记录结果和消息两个当前水位，只接续新数据；不扫启用前一小时、不自动补首屏旧报告、不重跑付费AI。暂停恢复使用原水位和队列。Mac 按 [上线交接](./PRODUCTION-ACTIVATION.md) 安装并启用独立 LaunchAgent，不改既有监听和 AI 服务。

## 9. 合成材料与下一步

- [完整市场报告](./report.example.json)：六栏结构、群名昵称、引用闭包、缺失元数据及CA覆盖。
- [完整业务报告](./report-business.example.json)：四类业务内容、负责人/截止时间均为合成。
- [实时CA](./ca-alert.example.json)、[关闭快照](./ca-alert-expired.example.json)、[追赶CA](./ca-alert-catchup.example.json)：覆盖更新、失效和不弹历史。
- [设备心跳](./heartbeat.example.json)：八字段、AI离线与CA在线可独立表示。
- [三类签名向量](./signature.example.json)：公开测试key、固定时钟、固定字节，禁止生产使用。
- 样例和验收源库全部合成；集成测试仅访问本机回环测试服务，不读取真实库/配置，不调用付费模型。来源正文只存在测试临时源库，不上传至网站。

原实现和合成证据见 [Windows 回执](./WINDOWS-RECEIVER-RECEIPT.md)，生产阶段见 [上线交接](./PRODUCTION-ACTIVATION.md)。用户已回传 Mac 47 项定向测试通过，并已批准启用。**合成测试、网站已上线、Mac 已启动、真实数据已抵达是不同状态**，最终以两端实际回执为准。
