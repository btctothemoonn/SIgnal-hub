# 企业微信群总结接入 SignalHub：两端交接规范 v1

日期：2026-09-06。状态：**供两端 Codex 审阅、对齐和实现的接入约定；不是接口已上线的声明。**

本次提交只包含文档及合成样例，不发布页面、接口或 Mac 常驻程序，不修改生产配置，不上传真实群消息。Signal 本地曾开始的实现草稿不属于本次交付；不能据此假设线上已有接口。

## 1. 仓库与协作边界

- Signal 仓库：<https://github.com/btctothemoonn/SIgnal-hub>，交接文档分支 `main`。
- 本文件：`docs/integrations/wecom-summary/README.md`。Mac 端先读取本文件及同目录全部样例。
- Mac 仓库已改名：<https://github.com/btctothemoonn/wecom-summary>。不要继续向旧名称提交。
- 前期研究依据：Mac 仓库 `codex/wecom-notification-probe` 分支的 `3ba605e6844913f866658dbd63b6b5a9db099b50`。这不是要求 Mac 回退到该版本。Mac Codex 应先核对当前分支、提交和运行版本，再反馈实际差异。
- Mac 负责：保留企业微信监听、群归属边界、现有总结调度和 MiniMax 配置；新增只读导出、独立可靠发送队列。不要改回普通微信监听。
- Signal 负责：独立接收服务、鉴权、持久化、登录后的展示页和 VPS 部署；不负责重新监听或调用模型重做群总结。
- 先代码审阅和合成数据联调，再交换专用凭证、确认首次同步范围，最后启用真实同步。两端各自提交自己的仓库，不需要 Mac SSH 暴露到公网。

## 2. 展示与数据范围

新增独立页面“群聊总结” `/wecom`，展示 2 小时 / 6 小时 / 24 小时报告、报告时间范围、生成时间、最后同步时间和设备状态。它不是 `/intel` 市场简报，也不混入 X/TG 信息流。

| 数据 | 默认行为 |
| --- | --- |
| 已成功生成的总结 | 同步最终版正文、话题、发现、模型名、窗口、生成时间及必要计数；不上传模型思考过程 |
| CA 讨论 | 可同步该份报告已有的合约地址、网络、聚合计数和分析；默认不上传群名及成员身份 |
| 原始群消息、逐条聊天、附件 | **不上传**；`sources: []`，各 `sourceMessageIDs: []`，CA 的 `groups: []` |
| 原文引用 | 首版默认关闭；仅在用户明确同意后增加有界引用。不得借“补充引用”上传整窗聊天 |
| 历史报告 | 默认不自动回填。正式启用时记录当前结果水位，只接续之后成功落库的结果 |
| 首屏旧报告/历史补传 | 可另行批准“每个周期最近 1 份”或明确时间范围；仅同步已存在的总结，不补跑付费 AI |
| 密钥和本机数据文件 | 永不进入 Git、请求正文、日志或浏览器；不上传数据库、LAN 密码、MiniMax Key、同步 secret |

总结文字本身也可能包含群内隐私。Mac 端导出必须字段白名单，检测和排除凭证；发现敏感内容时隔离该报告、显示固定错误码，不静默发送。需要映射匿名群名时先反馈约定，不自行扩大范围。

“已生成结果”以数据库成功落库为准。启用前已排队、启用后才成功完成的任务允许发送，这不意味着重新扫描历史聊天。用户尚未选择首次同步截止点时，只可本地 dry-run 或发送合成数据。

## 3. 独立运行与性能边界

```text
Mac 企业微信监听 -> 现有消息库 -> 现有总结进程 -> 已完成报告库
                                                    |
                                         只读导出 -> 本地持久队列
                                                    |
                                           HTTPS + HMAC
                                                    v
Signal 登录站点 -> 有界认证转发 -> VPS 独立接收进程 -> 独立 SQLite
                                                    |
                                         登录后的本地缓存读取页
```

- 浏览器只访问 Signal，不等待 Mac，不调用 AI。Mac 断网、重启、总结失败时保留服务器最后一次成功结果。
- 接收进程仅监听 VPS `127.0.0.1:3041`，不对公网开放该端口。与 Signal 主站进程隔离，独立数据库，禁止共用主信号流 SQLite 写锁。
- 下一阶段建议上限：单条请求 256 KiB、并发最多 8、接收连接最多 16、正文读取 3 秒、站内转发 3 秒；接收服务内存 192 MiB、CPU 配额 25%。这些是实施目标，需 VPS 实测，不是零影响承诺。
- 数据库含 WAL 的磁盘预算先设 256 MiB，达限拒绝新写入、报警并由 Mac 保留队列；不得自动删除未确认报告。容量扩充/历史保留周期另行确认。
- 列表每页 10 条、最多 10 条，只读简版字段；正文按需读取。页面可见时每 60 秒刷新，隐藏时停止；刷新失败保留已显示结果。
- 认证不能仅依赖“从网站转发过来”：接收进程必须再次校验 HMAC。签名和实际正文不一致必须拒绝。

## 4. 接口与认证

以下为**待实现目标**。Signal Codex 提供上线就绪确认前，不向生产地址批量发送。

| 接口 | 用途与权限 |
| --- | --- |
| `POST https://holdrich.online/api/wecom/ingest` | Mac 推送唯一公网入口；专用 HMAC，不用网页密码/Cookie |
| `GET /api/wecom/reports?cadence=two_hour&limit=10&before=...` | 登录用户读取分页摘要；游标由服务端给出，不自行构造 |
| `GET /api/wecom/reports?id=...` | 登录用户读取报告详情；ID 需 URL 编码 |
| `GET http://127.0.0.1:3041/health` | VPS 内部健康检查，不含报告、配置值或密钥 |

只对精确路径 `/api/wecom/ingest` 免除网页登录跳转，转而强制机器认证；其子路径及所有读接口仍受原站点登录保护。只支持 POST、`Content-Type: application/json`、UTF-8、无压缩，请求体最大 **262144 字节**。不允许重定向、更换域名转发签名、跳过 TLS 校验或把 secret 放入 URL。

必填请求头：

| 头 | 格式 |
| --- | --- |
| `X-Wecom-Device` | 1-64 位，`[A-Za-z0-9][A-Za-z0-9._-]*`；初期一个设备 |
| `X-Wecom-Timestamp` | Unix 秒，10 位十进制；不是毫秒 |
| `X-Wecom-Nonce` | 每次请求新生成的 16 字节随机数，32 位小写十六进制 |
| `X-Wecom-Signature` | HMAC-SHA256 结果，64 位小写十六进制 |

签名字符串由以下 6 行通过 ASCII `\n` 连接，**末尾没有换行**：

```text
POST
/api/wecom/ingest
{deviceId}
{timestamp}
{nonce}
{sha256(实际发送的原始 body 字节)，小写 hex}
```

以 secret 的 UTF-8 字节为 HMAC key。建议专用随机 32 字节以 64 位 hex 文本保存；签名时用该文本的 UTF-8 字节，**不是 hex 解码后的字节**。服务端至少要求 32 字符。不要重复 JSON 序列化后再验签，空格、中文转义和末尾换行都会影响 body hash。

离线跨语言校验使用 [signature.example.json](./signature.example.json)：对其中 `body` 字符串的 UTF-8 字节计算摘要，应匹配 `bodySha256` 和 `signature`。这个公开测试 key 不能用于生产；固定 timestamp 仅用于固定测试时钟，不能原样用于在线请求。

请求时间容差为前后 300 秒。服务端持久化已接受 nonce 至少 610 秒，重启不能丢失重放保护；nonce 与报告/心跳写入在同一事务中完成。重复 nonce 返回 409。Mac 重试必须换 timestamp 和 nonce，但同一报告版本保持原始 payload 不变。

私密配置示例（仅占位，不是可用凭证）：

```json
{
  "url": "https://holdrich.online/api/wecom/ingest",
  "deviceId": "mac-wecom",
  "secret": "<由两端在各自私密配置中填写同一个专用随机值>"
}
```

Mac 推荐路径 `~/Library/Application Support/wxFomo LAN/signalhub-sync.json`，目录 0700、文件 0600，拒绝不安全所有权/权限和符号链接。单独发送进程，不复用 LAN access-token 或 AI 配置。VPS 使用非公开环境变量 `WECOM_SYNC_DEVICE_ID`、`WECOM_SYNC_SECRET`、可选 `WECOM_RECEIVER_PORT=3041`。不得使用 `NEXT_PUBLIC_` 前缀。凭证通过用户控制的私密本机配置传递，不贴在 Git、PR 或聊天里；换 key 后需协调重载两端。

## 5. JSON v1

正文有两种，所有列出的字段必须出现；空集合用 `[]`，规定可空的值用 `null`。未知字段和未知 `schemaVersion` 拒绝，不忽略错误。完整合成示例见 [report.example.json](./report.example.json) 和 [heartbeat.example.json](./heartbeat.example.json)。

```text
{ "schemaVersion": 1, "type": "report", "report": { ... } }
{ "schemaVersion": 1, "type": "heartbeat", "status": { ... } }
```

Report 字段：

| 字段 | 规则 |
| --- | --- |
| `id` | 最长 1024，`[A-Za-z0-9][A-Za-z0-9._:-]*`；稳定、不含群名成员名，不用发送时刻生成 |
| `revision` | 正整数，最大 `9007199254740991`；当前不可变结果建议使用 `analysis_id` |
| `cadence` | `two_hour` / `six_hour` / `daily`，对应现有 2h/6h/24h 调度，不改动其时区/宽限时间 |
| `windowStart`, `windowEnd`, `generatedAt` | UTC ISO 8601，如 `2026-09-06T00:00:00.000Z`；起点小于终点。不要用推送时间覆盖生成时间 |
| `summary`, `model` | 非空文本，分别最长 10000 / 256 |
| `sourceCount` | 非负安全整数，原报告冻结输入数量；不是本次导出条数 |
| `sourceComplete` | 原报告输入是否完整匹配其冻结的本地消息范围；未知填 false，不代表企业微信绝对未漏消息 |
| `sourcesTruncated` | 来源详情未完整上传时 true；默认只总结模式在 `sourceCount > 0` 时 true |
| `topics` | 最多 30；每项 `{title, summary, sourceMessageIDs}`，长度分别 200 / 2000 / 最多 50 个 ID |
| `findings` | 最多 40；每项 `{category, text, epistemicStatus, sourceMessageIDs}`，category 最长 80，text 最长 2000，引用最多 50 |
| `caDiscussions` | 最多 50，格式见下文 |
| `sources` | 默认 `[]`，仅经用户授权后启用下述引用格式 |

`epistemicStatus` 只能是 `fact` / `inference` / `uncertain`，保留原总结的事实与推断区分，不把推断升级为事实。

每项 CA：`{address, network, groups, mentionCount, uniqueStatementCount, duplicateCount, summary, sourceMessageIDs}`。address 最长 128、network 最长 40；无现成网络结论可写 `unknown`，不能猜测。summary 是最长 2000 的文本或 null。三个计数是非负安全整数，必须满足 `mentionCount = uniqueStatementCount + duplicateCount`。裁剪展示不能更改原聚合计数。groups 默认空；获得同意后最多 50 项、每项 200。引用 ID 默认空，最多 5 项。

仅经批准后的引用项：`{id, group, sender, content, observedAt}`；id 同报告 ID 字符规则，group 最长 200，sender 最长 200 或 null，content 最长 800，observedAt 是上述 UTC 时间。每份最多 50 条、ID 唯一、只取报告实际引用的片段，不补充无关消息。`sourceCount >= sources.length`，引用因裁剪未导出时允许引用 ID 不出现在 sources 中。

文本长度统一按 **UTF-16 code units** 计数，兼容 JavaScript；Python 不能直接拿 `len()` 当这一上限。禁止非文本控制字符和无效 Unicode。单请求字节上限优先于所有字段上限。若超限，先缩减可选数组；不能通过静默丢失核心结论来强行发送，无法安全投影时本地隔离并报错。省略/裁剪情况必须可观察。

报告 ID 建议 `wecom:{deviceId}:{storeId}:{sha256(原始 job_id UTF-8)}`。storeId 为首次接入时持久化的随机 UUID，重启不得重建；同一结果重发不能换 ID。数据库重建/回滚造成 `analysis_id` 倒退时停止自动推进并报警，由操作者审阅后建立新 storeId，避免旧 ID 覆盖其他报告。

心跳字段：`{listener, worker, pendingReports, lastError}`。listener/worker 分别是 `online` / `offline` / `unknown`；取现有进程真实心跳而非“同步 HTTP 成功”推断。pendingReports 为未确认报告数，非负安全整数。lastError 是 null 或 `[a-z][a-z0-9_]{0,79}` 固定错误码，禁止直接放异常字符串、URL、消息正文或凭证。

## 6. 成功确认、去重与失败

```json
{"ok":true,"id":"<与请求相同>","revision":1,"disposition":"stored"}
```

- `stored`：已持久化新报告或更高版本；同 ID 更高 revision 才能更新。
- `duplicate`：同 ID、同 revision、同 payload，返回成功，不新增重复卡片。
- `stale`：服务器已有更高 revision，旧版本不覆盖，仍回显本次请求的 id/revision 以确认无需补传。
- 同 ID、同 revision 但内容不同：409 `revision_conflict`，必须检查原因，不能假装成功。
- 心跳成功只返回 `{"ok":true}`。报告必须核对 HTTP 200、JSON、ok、id、revision 和 disposition 全部匹配后才可出队；重定向、登录 HTML 或不匹配确认都不是成功。

| HTTP/错误 | Mac 行为 |
| --- | --- |
| 超时/断网/408/5xx | 保留原 payload，指数退避并加随机抖动；不重跑 AI |
| 429 | 按 Retry-After（最长 15 分钟）等待；无该头时退避 |
| 401 `invalid_signature` | 暂停发送并显示认证/时钟异常；不逐条丢弃报告 |
| 503 `sync_unconfigured`、404/405 | 视为服务尚未就绪，保留队列、低频探测，不连续重试 |
| 400/413/415 或 409 `revision_conflict` | 将该条持久化到失败队列，显示错误和计数；不堵住后续合法报告，不删除失败 payload |
| 409 `replay` | 保留 payload、生成新 nonce，按退避重试 |

错误响应为 `{"error":"固定错误码"}`，不得返回堆栈、聊天或数据库内容。数据库忙/磁盘满/接收进程失败返回 503，不确认尚未持久化的内容。匿名请求无权探测报告是否存在。

## 7. Mac 同步规则

1. 只读查询已完成结果表，按 `analysis_id` 升序增量分页。不要用现有只显示最近 30 份的 `/api/analyses` 当同步水位，也不要每分钟重读整窗聊天和重算全部历史 CA。
2. 保留现有源数据库、relay 归属边界和监听权限。原库以只读连接打开；同步队列、配置和 checkpoint 写入独立目录/库，不改原 schema 或迁移原库。
3. 每 60 秒检查新完成报告并发心跳；每轮最多导出 10 份、一次只发 1 个请求。总结生成仍沿用现有周期，不把 60 秒同步误做 60 秒 AI 生成。
4. 先将固定 payload 和读取水位在同步库同一事务中落盘，再发请求。读取水位只代表“已可靠入队”，不代表“服务器已收到”；发送确认单独持久化。损坏源行要留下可重试失败记录，不能静默越过。
5. 请求超时建议 10 秒；失败退避 5、10、20、40 秒递增至 300 秒并加抖动。有新任务也不能绕过已生效的全局限流/认证暂停。
6. 重启恢复未确认队列。最多 1000 条或 128 MiB 待发送数据，先达到任一上限就暂停继续读取并报警，不能删除未发送记录腾空间。源库仍保留原总结。
7. 不通过公网暴露 Mac 的 LAN 服务；发送端不跟随重定向，不把自定义认证头透传到其他域名，不在代理或诊断日志中打印认证头和正文。
8. 默认停用常驻同步，先 dry-run 合成数据及只统计候选数量。凭证、截止点和真实范围确认后，再安装/启用独立 LaunchAgent。关闭同步仅停止新模块，不停监听和总结。

原报告没有现成可安全投影的 CA 或来源信息时，先反馈缺失，不额外调用模型。源库暂时忙/不可读应重试；不能为了交付而伪造空报告或完整标记。

## 8. Signal 读取约定

列表响应：`{items, nextCursor, status}`。items 每项仅含 `id, cadence, windowStart, windowEnd, generatedAt, summary, model, sourceCount, sourceComplete, sourcesTruncated, syncedAt`；summary 是最多 450 字的预览。按 `(windowEnd DESC, id DESC)` 稳定游标分页，nextCursor 无下一页时 null。

详情响应：`{report, syncedAt}`，report 为完整 v1 Report。syncedAt 由服务器收取成功时生成，不能覆盖 Mac 的 generatedAt。

status 包含 `configured, connection, lastSeenAt, lastReportAt, listener, worker, pendingReports, lastError`。connection 为 `waiting` / `online` / `offline`，距有效心跳/请求超过 180 秒显示离线，时间未知用 null。同步连接在线不等于监听/总结进程在线。Mac 不在线也必须能读取历史缓存。

不要把上次同步时间、生成时间、窗口结束时间都写成“更新”。数据不可读需明确标错，避免错误的“0 条”覆盖用户已经看到的缓存。网页正文按安全文本/受限 Markdown 显示，不执行报告中的 HTML、脚本、链接指令。

## 9. 联调和验收门槛

- [ ] Mac Codex 回报当前分支/commit、成功报告表结构、现有监听和总结运行方式，标出与本协议冲突点；不得直接改监听和任务周期。
- [ ] 两端用同目录合成样例验证必填字段、时区、UTF-16/字节上限、签名；测试密钥不能用于生产。
- [ ] 测试篡改、错误 secret、过期时间、重复 nonce、过大 body、未知字段和未登录读接口均被拒绝。
- [ ] 同报告重发只一份；确认丢失后重试可恢复；旧 revision 不覆盖新结果；冲突隔离，不无限堵塞队列。
- [ ] 超过 30 份模拟积压不漏读；Mac 重启不丢队列；源库暂时不可读不被标为已同步；坏数据和磁盘达限可见。
- [ ] 断开 Mac、停止接收进程和模拟 429 时，Signal 现有页面仍可用、最后总结仍可见；无需付费模型调用。
- [ ] 默认只总结模式的请求无聊天原文、群名、成员身份和凭证；真实范围外的旧消息没有被导出。
- [ ] Mac/Linux 实测配置权限和开机恢复；VPS 验证资源限制、健康检查和首次部署回滚不影响旧站点。
- [ ] 桌面/手机浏览器验证登录、分页、周期切换、缓存回退及无重复卡片；对比启用前后的主站响应时间和内存，提供实测，不承诺绝不会卡顿。
- [ ] Signal 回传已部署 commit、接口就绪和拒绝匿名写入的证据；再由用户确认 cutoff/可选首屏报告，配置私密凭证并启用真实同步。
- [ ] 首次真实同步核对同一报告的窗口、正文、计数和生成时间；两端均确认后再视为上线完成。

## 10. 给 Mac Codex 的任务

先审阅本文件以及 `wecom-summary` 当前正在运行的版本，列出兼容性差异和最小改动范围。保留现有企业微信监听、总结调度、模型配置和原始数据库；只实现独立的只读导出与可靠同步模块。优先让合成数据测试通过，再与 Signal 端确认就绪。不擅自上传历史消息、原文、身份或密钥，不启用付费补跑，不在接口尚未就绪时打开常驻生产发送。

请将审阅结论和后续对接代码提交到 Mac 仓库自己的工作分支，并回传：仓库链接、分支、commit、改动文件、通过/未通过的测试、尚未确认项、合成请求示例和首次同步默认行为。不要只说“已接入”，要区分代码完成、接口联调和真实同步三个状态。
