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

## 审查修复（2026-07-13）

### 实现

- GET、轮询和 mutation 共享按 cache key 单调递增的请求序号。GET 仅在序号仍为当前值时提交快照、缓存和错误状态；mutation 成功会提升序号，使此前发出的 GET 失效。
- live snapshot 改为按 cache key 保存；mutation 从 `snapshotsRef` 读取最新快照，并通过函数式 state setter 提交，不再依赖 `live/cached` 闭包。
- active 页 dismiss 仍局部移除卡片；history 页保留卡片并设置 `dismissed=true`，按钮显示“已忽略”且禁用。
- feature-on 手机导航补齐 `tablist/tab/tabpanel`、稳定 ID、`aria-controls/aria-labelledby`、roving `tabIndex` 和左右/Home/End 键操作。非活动 panel 同时设置 `aria-hidden=true` 与 `inert`。
- 浏览器验证发现 CSS `scroll-smooth` 会让程序化切页的中间 scroll 事件短暂回退 active panel；仅在 feature-on scroller 移除该类并使用原子定位。feature-off 分支继续使用原有 smooth 行为。

### TDD 证据

1. 测试直接转译并执行生产 `opportunity-radar.tsx` 的纯逻辑导出；最初因序号和 mutation helper 不存在失败。实现后覆盖旧 GET 在 follow 成功后到达不能回退，以及 A→B→A 乱序响应不能覆盖最新 A。
2. active/history dismiss 差异测试最初失败；实现后验证 active 项目被移除，history 项目保留且 `dismissed=true`。
3. 移动 tab/tabpanel、关联 ID、`aria-hidden/inert` 和键盘操作断言均先失败后通过。
4. 浏览器复核捕获程序化平滑滚动导致的 ARIA 状态抖动；新增 feature-on 禁用 smooth 的失败断言后完成修复。

### 最终验证

- Focused：Opportunity Radar 与 responsive layout 2/2 通过。
- 相关布局：Opportunity Radar、responsive layout、homepage mobile layout、alpha summary layout 4/4 通过。
- 全量：`pnpm test`，138/138 test files 通过。
- 类型：`pnpm exec tsc --noEmit` 通过。
- Lint：6 个 Task 7 源码/测试文件定向 ESLint 通过。
- 差异：`git diff --check` 通过。
- 浏览器 feature-on desktop 1440x900：机会页可见、AI 右栏保留、无控制台错误或 Next 错误层。
- 浏览器 feature-on mobile 390x844：3 个 tab；click 与方向键切换后选中、焦点、`aria-hidden/inert` 完全一致；无控制台错误或 Next 错误层。
- 浏览器 feature-off：desktop 无机会入口且原 signals/AI 双栏可见；mobile 保持 2 个按钮、无 tab 语义并保留 smooth scroller。
- 本地验证服务已停止。

### 剩余顾虑

- 本地 Opportunity 数据为空，未在浏览器中对真实卡片执行 follow/dismiss；生产纯逻辑的可执行回归覆盖本次竞态与 active/history 局部更新，API mutation 合约继续由现有全量测试覆盖。
- 全量测试仍仅输出仓库既有的 Node experimental SQLite/transform-types 与 module-type 警告。
