# Task 7 Report: Opportunity Radar

## 状态

- 基线：`f6f06430bcf9ff5c12c3c3cdbaf586deafbee591`
- 规格：`.superpowers/sdd/task-7-brief.md`
- 结果：完成 Opportunity Radar 卡片、缓存读取、筛选、轮询、局部 mutation、feature flag 和响应式接入。
- 范围：仅修改 Task 7 白名单文件并新增本报告；未修改依赖、Opportunity 后端或 Signal Feed 内部实现。

## 实现

- `OPPORTUNITY_RADAR_UI_ENABLED !== "1"` 时保留原桌面双栏和手机两页布局。
- flag 开启时，桌面左侧提供 `推送 / 机会`，右侧 AI 总结保持原位；手机为 `最新推送 / 机会 / AI 总结` 三页，索引固定为 `0 / 1 / 2`。
- 机会卡展示评分、信心、市场、资产、事件、状态、完整时间窗、来源数、价格反应和有效期；展开后展示理由、风险、失效条件与原文证据。
- cache key 绑定 `market / sort / status` 和 live snapshot key；每 5 分钟读取一次列表。
- 手动刷新只读取 `/api/opportunities?...`，不调用 AI 或 worker refresh endpoint。
- 关注和忽略成功后仅更新当前浏览器快照及缓存，不重载页面或重新请求列表；失败保留当前快照。
- 图标按钮均有可访问名称和 tooltip，卡片最大圆角为 8px。
- feature-on 手机切离 feed 后隐藏 Signal Feed 固定阅读导航，不修改其阅读位置状态或行为。

## TDD 证据

1. 新增完整时间窗断言，测试因缺少 `firstSeenAt` 和“时间窗”失败；最小实现后通过。
2. 浏览器发现展开卡片造成 26px 页面级横向溢出；新增资产可访问名称断言并禁止该处 `sr-only`，测试先失败，替换后手机溢出为 0px。
3. 浏览器发现非 feed 页仍显示固定阅读导航；新增稳定 data attribute 隔离断言，测试先失败，feature-on 分支最小修复后通过。

## 验证

- Focused：3/3 通过。
- 全量：`pnpm test`，138/138 test files 通过。
- 类型：`pnpm exec tsc --noEmit` 通过。
- Lint：6 个 Task 7 源码/测试文件定向 ESLint 通过。
- 差异：`git diff --check` 通过。
- 浏览器 desktop 1440x1000：feature-off 原布局；feature-on 左侧双切换、Opportunity 卡片完整展开、AI 右栏可见、无横向溢出。
- 浏览器 mobile 390x844：feature-off 两页；feature-on 三页索引 `0/1/2`，机会页边界 `24..378/390px`，页面级横向溢出 `0px`，阅读导航只在 feed 页显示。
- 浏览器网络断言：手动刷新仅发出机会列表 GET；关注/忽略不增加列表 GET，且无 AI 请求。
- 本地验证服务已停止。

## 顾虑

- 全量测试仍输出仓库既有的 Node experimental SQLite/transform-types 与 module-type 警告；本任务未修改相关配置。
- 本地 Opportunity 数据为空时无法覆盖真实卡片 mutation，浏览器验证使用与 `OpportunitySnapshot` 接口一致的拦截快照和成功 mutation 响应。
