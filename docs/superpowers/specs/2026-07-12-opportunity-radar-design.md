# Signal Hub 机会雷达设计

## Summary

在现有 Signal Flow 内新增 `机会` Tab，不改变原始推送流。系统每小时从现有 TG、X、Patreon、抖音、新闻和行情缓存中提取候选事件，先通过确定性规则预筛，再由 AI 批量分析，最终每天保留 5-10 条高价值机会。

第一版同时覆盖美股、A股和加密市场。目标不是增加信息源，而是把已有信息整理成低噪音、可验证、可持续跟踪的决策线索。

## Goals

- 每天只展示达到质量阈值的机会，不为凑数量降低标准。
- 同一事件的多条消息合并为一张机会卡片。
- 所有 AI 结论都能回溯到原始证据。
- 后台自动运行，用户未打开网页时也能生成和缓存结果。
- AI 或行情接口失败时仍保留可用的规则结果。
- 关注和忽略操作可持久化，并影响后续排序。

## Non-Goals

- 第一版不新增外部信息源或付费 API。
- 不改动 Signal Flow 原始消息的采集、排序和展示逻辑。
- 不自动下单，不提供交易执行能力。
- 不实现实时分钟级推送；默认每小时整理一次。
- 不做固定市场配额。

## User Experience

### Entry Point

在 Signal Flow 的现有内容区域新增 `机会` Tab。原始推送视图保持默认入口和现有行为，机会雷达作为同级视图存在。

机会列表默认按综合价值评分从高到低排序，并支持切换为按最新出现时间排序。市场过滤支持：

- 全部
- 美股
- A股
- 加密

### Compact Card

首屏卡片展示：

- 综合评分和置信度
- 市场类型
- 相关股票、板块或代币
- 机会类型，例如财报、订单、政策、产品、资金或供应链
- 一句话机会逻辑
- 首次出现时间和有效窗口
- 独立来源数量
- 状态：新线索、持续验证、已确认、已失效

### Expanded Card

展开后展示：

- 为什么值得关注，最多三条核心依据
- 市场是否已经反应，包括相关资产涨跌和消息前后变化
- 证据链，关联 TG、X、研报、视频和新闻原文
- 主要风险，包括传闻、追高、流动性、财报和政策风险
- 明确的失效条件

卡片操作包括：

- 关注或取消关注
- 忽略
- 打开原文

手机端使用紧凑卡片，点击后原地展开，不使用复杂横向表格。

## Processing Architecture

新增独立后台服务 `signal-hub-opportunity`，每小时执行一次。服务只读取现有本地缓存和数据库，不重复请求上游 TG、X、Patreon、抖音或行情 API。

处理流程：

1. 从各现有缓存读取上次游标之后的新增内容。
2. 规范化市场、资产、来源、时间、正文和原文链接。
3. 过滤广告、闲聊、纯情绪内容、无资产对象内容和明显重复内容。
4. 根据资产、事件类型、关键实体、时间窗口和文本相似度形成事件簇。
5. 对事件簇执行确定性规则评分。
6. 选择高分候选，合并为一批交给 AI 分析。
7. 校验 AI 输出是否引用已有证据，计算最终评分和状态。
8. 更新现有机会或创建新机会，并写入处理游标。

同一事件出现新证据时更新原卡片，不创建重复卡片。worker 重启后从持久化游标继续处理。

## Scoring Model

规则层先计算 `rule_score`，总分 100：

- 来源质量：20
- 标的和方向是否明确：15
- 催化逻辑是否具体：20
- 多来源交叉验证：15
- 时效和有效窗口：10
- 是否关联 Holding 或 Stocks 研究池：10
- 市场是否尚未充分反应：10

扣分项包括：

- 单一匿名来源或无法验证的传闻
- 只有观点，没有事件、数据或可验证事实
- 价格已经大幅反应，追高风险明显
- 内容重复、过期或旧消息重新传播
- AI 结论无法从原始证据中找到支持

AI 对规则候选返回 `ai_adjustment`，范围为 `-15` 到 `+15`。调整只评价催化逻辑完整度、证据一致性、风险和失效条件，不重复奖励来源数量或持仓关联。最终分数计算为：

```text
final_score = clamp(rule_score + ai_adjustment, 0, 100)
```

AI 不得把缺少可验证证据的单一来源候选提高到 75 分以上。AI 全部失败时 `ai_adjustment` 记为 0，规则分达到 75 的候选仍可入选，但置信度固定为 `规则判断`，并显示 `AI 待补充`。

最终分数达到 `75` 才进入机会列表。每天按 Asia/Shanghai 自然日最多保留 10 条，可以少于 5 条。市场之间不设置固定配额，重大事件可以占用当天全部名额。

## Opportunity Lifecycle

- `新线索`：首次达到展示阈值，但证据仍有限。
- `持续验证`：后续周期出现新的独立证据，事件仍在有效窗口内。
- `已确认`：关键事实获得可靠来源或市场数据确认。
- `已失效`：达到 `valid_until`、命中失效条件，或关键事实被否定。

状态只能依据新增证据或时间规则变化，AI 不能在没有新证据时自行把机会升级为 `已确认`。已失效机会进入历史列表；被用户关注的机会即使失效也保留关注标记。

## AI Behavior

规则层先预筛，AI 不逐条分析全部消息。每小时把少量事件簇批量提交给 AI，以控制调用次数和上下文成本。

AI 结构化输出包括：

- 一句话机会逻辑
- 相关资产和市场
- 催化类型
- 最多三条核心依据
- 风险和失效条件
- 有效窗口
- 方向和置信度
- 引用的证据 ID

AI 不得创建输入中不存在的事实、数字、资产或来源。无法引用证据的候选只能标记为 `待验证`，不能获得高置信度。

Provider 顺序沿用现有配置：

1. Minimax
2. DeepSeek fallback

两个 Provider 都失败时保留规则评分候选，标记 `AI 待补充`，后续周期再尝试补全。

## Data Model

使用现有本地 SQLite 体系新增以下逻辑表：

### opportunity_clusters

- `id`
- `market`
- `event_type`
- `canonical_key`
- `first_seen_at`
- `last_seen_at`
- `status`
- `rule_score`
- `ai_score`
- `final_score`
- `confidence`
- `thesis`
- `valid_until`
- `invalidated_at`
- `created_at`
- `updated_at`

### opportunity_evidence

- `id`
- `cluster_id`
- `source_type`
- `source_id`
- `source_name`
- `published_at`
- `text_excerpt`
- `original_url`
- `asset_keys`
- `content_hash`

`cluster_id + source_type + source_id` 保持唯一，避免重复证据。

### opportunity_evaluations

- `id`
- `cluster_id`
- `provider`
- `model`
- `prompt_version`
- `input_hash`
- `result_json`
- `status`
- `error_message`
- `created_at`

相同 `input_hash` 不重复调用 AI。

### opportunity_preferences

- `cluster_id`
- `followed`
- `dismissed`
- `updated_at`

### opportunity_worker_state

- 每类数据源的处理游标
- 上次成功时间
- 上次错误
- 当前 prompt 版本

## Public Interfaces

### GET /api/opportunities

可选参数：

- `market=all|us|cn|crypto`
- `sort=score|latest`
- `status=active|history`
- `limit`

返回机会卡片、证据摘要、用户状态和最后更新时间。

### POST /api/opportunities/:id/follow

更新关注状态。请求体包含 `followed: boolean`。

### POST /api/opportunities/:id/dismiss

将机会标记为忽略。忽略不会删除历史证据。

### POST /api/opportunities/refresh

重新读取最新机会缓存，不强制触发 AI 生成，避免用户点击造成额外额度消耗。

## Ranking And Preference Behavior

默认排序以最终评分为主，更新时间为次。用户关注的机会固定在有效机会列表前部，但仍显示原始评分。

忽略行为不直接修改基础评分。系统记录被忽略机会的来源、事件类型和质量特征，后续可以作为个性化排序的弱信号，但第一版不自动屏蔽整个来源或市场，避免误伤。

## Error Handling

- 数据源缓存缺失：跳过该来源，其他来源继续处理。
- 行情数据缺失：不阻塞机会生成，显示 `价格待获取`。
- AI 超时或额度耗尽：切换 Provider，全部失败则保留规则结果。
- AI 返回非法结构：记录失败，不覆盖上一版有效分析。
- worker 中断：事务回滚，游标不前移，下次继续处理。
- 数据库写入失败：保留上一版快照，健康中心显示错误。
- 证据原文失效：保留摘要和来源信息，并标记链接不可用。

## Health And Operations

将 `signal-hub-opportunity` 纳入设置页的信息健康中心，展示：

- systemd 服务状态
- 上次成功运行时间
- 本周期新增候选数
- AI 分析事件簇数量
- 当天入选机会数量
- Provider 和 fallback 状态
- 最近错误

日志不得记录 API Key、Cookie、完整私有研报正文或用户密码。

## Test Plan

### Rules And Data

- 广告、闲聊和无资产对象内容被过滤。
- 同一事件的 TG、X 和新闻消息形成一个事件簇。
- 新证据更新原事件而不是创建重复事件。
- 达到 75 分才进入机会列表。
- 每天最多保留 10 条，且不为凑数量降低阈值。
- 三类市场可以同时出现，且不存在固定配额。
- 关注、忽略和历史状态能持久化。
- worker 重启后从原游标继续。

### AI

- 只对规则层候选调用 AI。
- 同一输入哈希不会重复生成。
- Minimax 失败后切换 DeepSeek。
- 两个 Provider 都失败时保留规则结果。
- AI 引用不存在的证据 ID 时结果被降级或拒绝。

### API And UI

- 机会列表支持市场、排序和状态过滤。
- 关注与忽略操作正确更新。
- 手动刷新不触发 AI 强制生成。
- 无数据、加载、错误和历史状态均能正常展示。
- 手机端卡片无横向溢出，展开内容不遮挡底部导航。
- 原始 Signal Flow 行为和现有阅读位置功能不回归。

### Verification

- 运行全部 Node 合约测试。
- ESLint 零错误、零警告。
- TypeScript 检查通过。
- Next.js 生产构建通过。
- 桌面和 390px 手机视口浏览器验收。
- VPS 部署后确认所有现有服务和新 opportunity worker 为 active。

## Rollout

第一步只让 worker 生成内部结果并记录评分，不在页面展示，用一到两天观察候选质量和 AI 消耗。确认阈值合理后打开 `机会` Tab。若误报过多，提高阈值或调整扣分；若长期没有结果，先检查预筛规则，不直接降低证据要求。

## Assumptions

- 第一版复用现有 Minimax 和 DeepSeek 配置。
- 现有消息、研报、视频和行情缓存是唯一输入来源。
- 系统服务部署在当前 Ubuntu VPS。
- 时间展示继续使用网站现有时区和格式化规则。
- 机会雷达仅用于信息筛选，不构成交易建议。
