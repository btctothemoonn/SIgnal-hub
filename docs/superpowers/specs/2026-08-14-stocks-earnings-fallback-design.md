# STOCKS 财报多源回退设计

## 目标

修复财报速览中预计值或公布值为空的问题。系统优先使用直接财务数据，在主来源缺失或套餐受限时自动查询现有备用来源，并在界面中标明数据来源和推算方法。

本轮同时执行已确认的 STOCKS 海力士溢价下线：只取消 STOCKS 页面挂载，Signal 首页保持不变。

## 数据优先级

### 公布值

1. FMP 季度 Income Statement。
2. Alpha Vantage 季度 Income Statement。
3. Yahoo 季度财务报表。
4. 若净利润公布值仍缺失，但存在报告 EPS 和同季度稀释股数，则使用 `报告 EPS × 稀释股数`，标记为“EPS 推算”。

### 预计值

1. FMP Analyst Estimates 的营收、净利润直接一致预期。
2. Finnhub Earnings Calendar 的营收、EPS 一致预期。
3. EODHD Earnings Trends 的营收、EPS 一致预期。
4. Alpha Vantage Earnings Estimates 的营收、EPS 一致预期。
5. 净利润预计值没有直接数据时，使用 `EPS 一致预期 × 稀释股数`，标记为“EPS 推算”。

备用源按需调用：已有完整 FMP 数值时不请求其他来源。所有数据必须按 ticker、财年、财季或允许误差不超过 7 天的财政期结束日匹配，禁止把不同季度的数据拼接。

## 数据模型

保留现有 `StocksEarningsComparison` 对前端的兼容性，并增加字段级来源：

```ts
type EarningsValueProvenance = {
  provider: "fmp" | "finnhub" | "eodhd" | "alpha-vantage" | "yahoo";
  method: "direct" | "eps-times-diluted-shares";
};
```

营收预计值、营收公布值、净利润预计值和净利润公布值分别记录来源。推算值不覆盖后续获取到的直接值。

## 失败处理

- 单个来源的鉴权、套餐、限流或空响应不会中止该 ticker 的其他回退。
- 最近一次完整缓存继续保留，失败刷新不得用空结果覆盖。
- 所有来源均无可用数值时，字段显示“数据源未覆盖”或“等待公布”，不留空、不伪造数字。
- AI 不参与补数，只消费已经匹配并带来源的结构化数据。

## 刷新与成本

- 多源补数由 Stocks cache worker 执行，浏览器只读取缓存。
- 先执行 FMP；只为缺失字段调用备用源。
- 同一 ticker、财年、财季的完整结果进入现有财务缓存，避免每次打开页面重复请求。
- 保持现有后台刷新间隔，不新增浏览器轮询。

## UI

- 财报表保持“营收、净利润；预计值、公布值、较预期”的结构。
- 数值旁以短标签显示来源，例如 `FMP`、`Finnhub`、`EODHD`、`AV`、`Yahoo`。
- 推算值显示 `EPS 推算`，详情说明使用的 EPS 来源和稀释股数来源。
- 不再显示空白单元格；缺少可靠数据时显示明确状态文字。

## 测试

- FMP 完整时不调用备用源。
- FMP 预计值返回 402 时，按 Finnhub、EODHD、Alpha Vantage 顺序补齐。
- FMP 公布值缺失时，从 Alpha Vantage 或 Yahoo 补齐。
- 直接净利润预计值缺失时，正确计算并标记 EPS 推算值。
- 不同财季数据不能合并，直接值优先于推算值。
- 所有来源失败时显示明确状态且不覆盖旧缓存。
- STOCKS 页面不再挂载海力士溢价组件，Signal 首页仍保留。
- 全量测试与生产构建通过。

## 官方接口依据

- FMP Financial Estimates: https://site.financialmodelingprep.com/developer/docs/analyst-estimates-api/
- Finnhub Earnings Calendar: https://finnhub.io/docs/api/indices-constituents
- EODHD Earnings Trends: https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits
- Alpha Vantage Earnings Estimates: https://www.alphavantage.co/documentation/

