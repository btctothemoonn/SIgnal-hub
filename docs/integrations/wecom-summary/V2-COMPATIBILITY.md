# v2 对齐回执与不兼容项

对齐来源：Mac `dc259a93ab41a8b00f64a638a5a3ab0c762ffb95`，分支 `codex/wecom-notification-probe`。Signal 对照基线 `55dfa50`。本次只更新接入文档、合成样例及离线样例校验材料，未修改生产接口或部署。

## 已接受的 Mac v2 设计

- report 保留 v1 外壳并新增完整 briefing、scope、sourceReferences、caCoverage；三条速读不是详情正文。
- 群名、昵称和观点归属保留；sources 固定空，只导出实际引用的来源元数据，不导出原始聊天。
- 独立 ca_alert：1 小时/至少 2 群、30 分钟新提示冷却、10 秒增量检查、15 秒可见刷新；未知链不强行跨群合并。
- 同 episode 持久 ID/revision、notificationVersion、catchup、关闭快照、第二新群时间过期规则及首次接收时间语义。
- heartbeat 增加 CA 检测器、CA 待发送数及两个观测时间，不能用 AI 在线推断实时通道在线。
- 保留入口、HMAC、固定字节重试、持久确认及错误分类；所有读页面/API均执行本人登录授权，不公开缓存。
- 保持双水位、只读源库、独立队列、默认不启用、不回填、不补跑付费 AI。

## 与 Signal v1 不兼容

| 项目 | 不兼容点 | 必须处理 |
| --- | --- | --- |
| 协议版本 | v1 严格校验会拒绝 schemaVersion=2 和新字段/type | 新版独立严格校验，不在 v1 对象中偷加字段；不静默降级或丢字段 |
| 完整报告 | v1 summary/topics/findings 不承载新版完整内容 | 页面/存储保留 briefing，market 六栏与 business 四类都渲染 |
| 身份与引用 | v1 默认清群名/昵称/引用，sources 允许原文格式 | v2 保留授权身份，sourceReferences 精确元数据且无 content，sources 非空即拒绝 |
| 完整性 | v1 的 sourcesTruncated 容易与正文裁剪混淆 | v2 仅表示不分享原文；scope 和 caCoverage 分别标冻结缺口/聚合裁剪 |
| 长度 | briefing 源规则 600 Python 字符，不等于 600 UTF-16 单位 | 传输上限1200 UTF-16；源端原600字符仍校验，群/昵称200和总256KiB不放宽 |
| 实时 CA | v1 只有报告内 CA，没有 episode/过期/冷却 | 新 typed 存储和历史/active API，不能把 caDiscussions 伪装实时提醒 |
| 设备状态 | v1 心跳只有4字段 | v2 必须8字段；旧校验器/界面不能直接复用 |
| 接收与通知 | v1 没有首收时间/notificationVersion/catchup | 固化 firstReceivedAt，旧版不复活关闭卡片，延迟/追赶不弹新提醒 |
| 历史 v1 数据 | 同ID/revision增加v2字段将触发异内容冲突 | 不自动重写已确认payload；若以后确有v1数据须单独迁移，不伪造revision。当前未启用同步，无需执行迁移 |
| 源查询说明 | 旧文档称最近30份；Mac已变为上海最近3个日历日 | 不能靠列表API查增量，直接按analysis_id只读成功结果表 |

## 对 Mac 提议的明确化

以下没有改变已确认产品规则，也没有向 Mac 上传对象增加未商定字段：

1. **网络标签与地址大小写分离。** 读取 dc259a9 的 cross_ca.py，规则网络值为小写 base/bsc/ethereum/arbitrum/polygon/optimism/avalanche/solana（报告另允许 unknown）。样例使用 `network: "base"`；briefing.chain 保留原总结的 `Base`，address 原字符串不改。
2. **早于 expiresAt 的关闭合法。** record_version 修订、归并/删行可使第二个群提前消失；expired 使用最后有效快照，不强制 evaluatedAt 已超过预计过期时间。显式关闭仍优先失效。
3. **站点读取字段不回传。** CA 读项新增 firstReceivedAt/syncedAt/effectiveStatus/delayed，为服务器本地派生；它们不属于 Mac alert 白名单。`GET /api/wecom/status` 是同一授权状态对象的独立读取入口，不改变 heartbeat 上传结构。
4. **未知版本要停止该版本发送并反馈。** 不可按普通坏行连续隔离整个历史积压，更不能自动转成不完整 v1；仍沿用400 unsupported_schema，不改HMAC。
5. **同版幂等按原始字节。** 保留Mac sort_keys紧凑UTF-8编码，换nonce不换body。对象的type在请求上下文匹配，持久键隔离type，不增加ack字段。

## 尚未具备的实现能力

- **本人授权是上线前置条件。** Signal 当前 `src/lib/admin-auth.ts` 只有单管理员会话，token没有userId；现阶段不能声称已有多账号数据隔离。首版必须是本人独占管理员空间，否则先实现身份与设备归属权限，不能把“任意已登录”当作本人授权。此项不要求 Mac 更改 payload。
- **原文证据只在 Mac 验证。** Signal 不拥有正文，无法验证地址是否真实出现在原聊天或结论是否有充分证据；只能检查结构、引用闭包和计数。不能把 available=true、签名正确写成内容已核验。
- **时效尚未测得。** 现有 wire alert 没有 inserted_at；其 triggeredAt 到首次接收只能测传输段，不能单独证明采集入库到网页 <=60秒。后续用合成源库时钟、Mac本地观测及浏览器显示记录关联测量；不私自增加真实消息时间/事件ID上传字段。
- **缺口数字并未全部暴露。** Mac方案要求本地记录过期未检测数和隔离数，但8字段heartbeat未单列这些计数。首版可用固定错误码显示有缺口/积压；若网页要具体数字，需另行扩展协议，不能偷偷放进lastError自由文本。
- **接收器/页面仍未上线。** 本次文档对齐不等于服务具备v2、权限、15秒刷新或可靠队列能力；两端实现、合成端到端测试与资源测试均需下一阶段完成。

## 校验范围

同目录全部数据均为合成，不从真实数据库复制。离线检查覆盖字段、引用闭包、计数、market/business结构、关闭/catchup快照、禁止原文、UTF-16与签名样例；签名还须由Python标准库独立复算。

这些检查不是生产安全审计或网络联调：登录授权、重放持久性、并发、数据库事务、UI提示规则及完整60秒目标不能靠JSON样例宣称通过。现在只可据此推进离线实现，不可启用生产发送。

### 本次实际结果（2026-09-06）

- 6个v2正文样例通过本地离线字段/计数/引用检查；额外验证关闭快照、提前关闭、600个补充平面字符及文档相对链接。
- 26个非法合成变体被拒绝，含v1版本、原文键、悬空引用、伪造缺失身份、计数错误、非空无引用结论、非法Unicode、超长昵称/正文、未知实时链、重复群、catchup弹新提醒以及把服务器字段上传等。
- 两份完整briefing通过从Mac dc259a9直接读取的validate_briefing；地址证据为测试构造的合成证据，不代表核验真实消息。600个补充平面字符也通过Mac原600字符边界。
- report/ca_alert/heartbeat三类公开向量的排序UTF-8字节、SHA256、HMAC-SHA256经Node生成和Python标准库独立复算一致。
- 没有调用付费模型、访问真实源库、读取运行凭证或向任何接收接口发送数据；未运行生产API/浏览器/时效测试。
