# Stocks FMP 财报速览设计

## 目标

将 Stocks 个股详情中现有的“结构与财报”模块替换为财报速览模块。模块自动为研究池中的每只股票展示最近一期季度财报的营收和净利润预测值、公布值、较预期差额及幅度，并生成简洁的业绩洞察。

用户添加新股票后不需要提供截图或手工录入数据。截图只用于确认界面结构和计算口径。

## 已确认决策

- 数据方案采用单一供应商 `FMP`。
- 市场一致预期来自 FMP Financial Estimates API。
- 公布值来自 FMP Income Statement API。
- 财报日期和盘前/盘后信息来自 FMP Earnings API。
- 财务口径采用 FMP 标准化报表；美国本土发行人标记为 GAAP，使用 IFRS 的海外发行人按实际口径标记，不把所有 ADR 强行标为 GAAP。
- FMP 的一致预期可能与富途使用的标普一致预期不同，页面以 FMP 返回值为准，不手工对齐第三方截图。
- 模块直接替换现有“结构与财报”，不新增页面或主导航。
- Signal Flow、Holding、抖音和 Stocks 其他保留功能不在本次修改范围内。

## FMP 接口

每个研究池 ticker 使用以下稳定版接口：

1. `GET /stable/income-statement`
   - 参数：`symbol`、`period=quarter`、`limit=9`。
   - 使用字段：季度日期、财年、季度、币种、营收、净利润及计算同比所需的上一年同期值。
2. `GET /stable/analyst-estimates`
   - 参数：`symbol`、`period=quarter`、足够覆盖最近季度和未来季度的 `limit`。
   - 使用字段：平均营收预测、平均净利润预测、预测日期和分析师数量（如果接口提供）。
3. `GET /stable/earnings`
   - 参数：`symbol`、覆盖最近财报的 `limit`。
   - 使用字段：财报日期、财年、季度和盘前/盘后状态。

现有现金流、财务增长等 FMP 请求继续服务其他保留字段。本模块不使用 EPS 反推净利润预测。

生产环境的 FMP 套餐必须允许访问季度 `analyst-estimates`，并返回 `estimatedRevenueAvg` 和 `estimatedNetIncomeAvg`。当前 Key 对 NBIS、CBRS 请求该接口会返回 HTTP 402，因此部署前必须升级或替换为具备权限的 Key。

## 数据模型

新增结构化季度财报对象，所有金额在逻辑层保存为原始数字，不提前格式化为字符串：

```ts
type StocksEarningsComparison = {
  ticker: string;
  fiscalYear: number;
  fiscalQuarter: string;
  fiscalPeriodEnd: string;
  reportDate: string | null;
  reportTiming: "bmo" | "amc" | "dmh" | null;
  currency: string;
  basis: "gaap" | "ifrs" | "fmp-normalized";
  revenue: EarningsMetricComparison;
  netIncome: EarningsMetricComparison;
  provider: "fmp";
  updatedAt: string;
};

type EarningsMetricComparison = {
  estimate: number | null;
  actual: number | null;
  priorYearActual: number | null;
  estimateYoYPercent: number | null;
  actualYoYPercent: number | null;
  surpriseAmount: number | null;
  surprisePercent: number | null;
};
```

财务快照为每只股票提供 `latestEarnings`。后台另存最近 8 个季度的历史记录，当前页面只读取最近一期，避免增加首屏响应体。

## 季度匹配

不同接口的数据只能在以下条件全部成立时合并：

- ticker 标准化后相同。
- 财年相同。
- 财季相同；优先使用明确的 `Q1` 至 `Q4`。
- 如果接口缺少财季，则使用财政期结束日进行匹配，允许的日期误差不超过 7 天。

若季度无法唯一匹配，不生成“较预期”数据。不得用最新一条预测与任意一条公布值直接拼接。

新股票第一次进入研究池时回填最近 8 个季度；此后每次刷新按 ticker、财年、财季执行幂等更新，不产生重复记录。

## 计算规则

营收和净利润使用同一套计算方式：

```text
较预期金额 = 公布值 - 预测值
较预期比例 = (公布值 - 预测值) / abs(预测值) * 100
同比 = (本期值 - 上年同期值) / abs(上年同期值) * 100
```

该规则确保亏损低于预期时得到正数。例如净亏损从预测 `-273.8M` 改善为公布 `-190.4M`，较预期金额为 `+83.4M`，方向判定为超出预期。

当预测值或上年同期值为 `0` 或缺失时，对应百分比为 `null`，页面显示 `n/a`，不进行除零或推断。

## 后台刷新与缓存

复用现有 Stocks cache worker：

- worker 启动时立即刷新财务数据。
- 常规财务刷新间隔保持每 1 小时一次。
- 前端继续每 30 分钟读取服务端缓存，不直接调用 FMP。
- 研究池新增 ticker 后，下一次 worker 刷新自动发现并回填。
- 取消 FMP 财务数据默认只处理前 8 个 ticker 的行为，覆盖完整研究池。
- FMP 请求采用有限并发，默认并发数为 3，避免一次性冲击限流。
- 多个 FMP Key 继续按 ticker 轮换；重试时允许切换 Key。

最近成功快照继续保存在 VPS 运行时目录。刷新失败不得覆盖成功缓存。

## 失败处理

- `429` 或 `5xx`：最多重试 2 次，使用递增退避并轮换可用 Key。
- `401`、`402` 或 `403`：标记为鉴权或套餐权限错误，不在同一轮内重复请求。
- 单只股票失败：保留该股票最近一次成功数据，不阻塞其他 ticker。
- 只有预测值缺失：继续显示公布值，预测值和较预期显示 `n/a`。
- 只有公布值缺失：显示预测值并标记“等待公布”。
- 季度匹配失败：显示“季度数据待校验”，不计算 surprise。
- 全部请求失败且存在缓存：展示缓存并标记更新时间和“缓存数据”。
- 全部请求失败且无缓存：模块显示明确错误，不使用 mock 数字。

页面错误信息面向用户，只显示供应商、状态和可执行含义；HTTP 响应摘要保留在 worker 日志，不把 API Key 或完整上游响应暴露到浏览器。

## UI 结构

`alpha-stock-detail` 中的“结构与财报”由以下内容替换：

1. 财报抬头
   - 复用个股详情顶部已有的 ticker、公司名称、当前价格和日涨跌，不在财报模块内重复展示。
   - 模块内显示财年财季、财报日期、盘前/盘后、币种及 GAAP、IFRS 或 FMP standardized 标签。
   - 根据两项指标结果显示“双项超预期”“表现分化”或“双项不及预期”。
2. 财报速览表
   - 固定两行：营收、净利润。
   - 固定四列：指标、预测值（同比）、公布值（同比）、较预期（幅度）。
   - 数值以美元 `K/M/B` 自适应格式显示，内部计算仍使用原始数字。
3. AI 业绩洞察
   - 核心结论。
   - 主要驱动。
   - 风险跟踪。
4. 数据说明
   - 显示 `FMP`、实际财务口径、缓存状态和更新时间。

桌面端使用横向四列表格。手机版保留四列但压缩间距和字号，不使用横向滚动；长数值采用较短单位格式，不能遮挡相邻列。

## AI 业绩洞察

AI 输入只包含已匹配的结构化财报数字和仍保留的公司研究背景：

- 不允许 AI 补充缺失预测值或公布值。
- 每个 ticker、财年、财季只生成一次并缓存。
- 财务数据发生修订时使对应摘要缓存失效。
- AI 失败时使用确定性模板生成基本结论，财报表格不受影响。
- 洞察必须区分“超预期”和“同比增长”，不能把两者混为一谈。

## 公共接口变化

`GET /api/stocks-financial-data` 保留现有字段，并为每个 ticker 增加可选的 `latestEarnings`。旧客户端忽略新增字段即可继续工作。

前端不新增直连 FMP 的请求，不向浏览器发送 API Key。

## 测试

### 规则测试

- NBIS 样例：营收和净亏损的 surprise 金额、比例及方向计算正确。
- 亏损改善时显示超预期，亏损扩大时显示不及预期。
- 预测值为 0、空值或非数字时不计算百分比。
- 不同财年或财季的数据不能合并。
- 财季缺失时，只有财政期结束日在允许误差内才能匹配。
- 同一季度重复刷新执行幂等更新。

### Provider 测试

- FMP 三个端点字段正确解析。
- 429、5xx、401、402、403 的重试和错误分类正确。
- 多 Key 轮换不泄露 Key。
- 单个 ticker 失败不影响其他 ticker。
- 旧缓存不会被失败结果覆盖。

### 组件测试

- 完整数据、缺少预测值、等待公布、缓存数据和完全失败状态均能渲染。
- 桌面端和手机版显示两行四列，不产生横向溢出。
- AI 摘要失败时仍显示财报表格和确定性结论。
- 原“结构与财报”内容不再重复出现。

### 全量验证

- 现有 Node 测试全部通过。
- ESLint 通过。
- `npm run build` 通过。
- 本地浏览器验证桌面和手机断点。
- VPS 部署后确认 Stocks worker 正常、缓存持续更新且页面不暴露 FMP Key。

## 非目标

- 不接入 S&P Capital IQ、富途、FactSet、Refinitiv 或 Bloomberg。
- 不保证 FMP 一致预期与富途截图数字完全相同。
- 不新增估值、市盈率、市销率或期权波动率模块。
- 不新增独立财报页面或历史财报浏览 UI。
- 不改变研究池管理方式、Signal Flow 或其他主板块。
