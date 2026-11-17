# 方程式新闻与实盘交易实施记录

目标为 `/news` 提供新闻流、行情联动及币安 / Hyperliquid 手动交易。设计依据 `docs/superpowers/specs/2026-11-16-eqn-news-trading-design.md`。

## 约束

- 使用现有 AppShell、登录和运行时存储目录。
- 新闻由独立 worker 入库，浏览器通过站内接口读取。
- 新闻翻译使用源数据，所有交易必须由用户手动操作。
- 密钥仅进入独立 trader 服务，交易开关和账户配置由部署环境提供。
- 所有下单保留客户端订单号，超时进入查询核对流程。
- 实盘风控默认值来自方案，配置值在页面显示。
- GitHub 推送在统一验证后执行。生产实盘验证需要用户配置账户。

## 接口约定

共享浏览器类型位于 `src/lib/news-terminal-types.ts`。

- `GET /api/eqn-news?channel=&coin=&q=&source=&before=&limit=` 返回 NewsFeed。
- `GET /api/eqn-news/stream` 通过 SSE 的 `message` 事件发送 `{type:"update"}` 和状态，页面重新取列表。
- `GET /api/eqn-news/[id]?coin=&venue=` 返回所选币种和交易所的 NewsDetail。
- `GET /api/eqn-news/market?symbol=&interval=&venue=&assetId=` 返回 NewsMarket。有币种 ID 时校验资产身份，报价使用交易所原生合约单位。
- `GET /api/trade/status` 返回 TradeStatus。登录后可读，响应包含 CSRF 令牌。
- `POST /api/trade/unlock` 接收 `{pin}`，要求同源和 `X-CSRF-Token`。
- `POST /api/trade/lock` 锁定当前交易会话。
- `POST /api/trade/order` 接收 TradeRequest。
- `POST /api/trade/cancel` 接收 `{venue, symbol, orderId}`。
- `POST /api/trade/close-all` 接收 `{venue}`，由用户针对当前账户执行。
- 所有失败响应为 `{error:string}` 并使用正确 HTTP 状态码。

## 执行任务

- [x] 新闻后端，官方 MCP / WS 客户端、SQLite 去重和补漏、行情与详情接口、worker / systemd 文件、定向测试。
- [x] 交易后端，独立 Python trader、交易所适配、风控和幂等、Node 代理与交易解锁、配置文档、定向测试。
- [x] 页面，三栏终端、筛选和搜索、行情 K 线与新闻点位、交易与详情标签、持仓挂单与成交、移动端适配。
- [x] 验证，生产构建、lint、297 个 JavaScript 测试文件、39 项交易测试、4 项浏览器测试和官方新闻接口检查。

## 实现决策

- 先完成用户要求的新闻与手动交易主流程，多面板和新闻 Web Push 规则留在后续一期。
- 历史方案中假定现有图表路由可提供 K 线 JSON，实际该路由只返回 SVG，因此为终端增加独立缓存行情接口。
- MCP 的 before 是向过去翻页的游标。补漏从最新页向后扫描到已存储的水位。
- 页面和 API 继续遵循仓库现有登录授权规则。
- 生产 API 凭据未提供时显示未连接，可完成合成交易所响应测试和公共行情验证。
