# 海力士溢价回归套利资金费记录

## 策略方向

- 做空 `SKHYUSDT`
- 做多 `SKHYNIXUSDT`
- 溢价公式：`SKHYUSDT * 10 / SKHYNIXUSDT - 1`

## 理论资金费计算

Binance 合约资金费率为正时，多头付费、空头收钱。

本策略单期理论资金费收益率：

```text
combinedFundingRate = SKHYUSDT fundingRate - SKHYNIXUSDT fundingRate
```

- `combinedFundingRate > 0`：这组仓位理论上收资金费。
- `combinedFundingRate < 0`：这组仓位理论上付资金费。
- `combinedFundingFeePer10kUsdt = combinedFundingRate * 10000`

示例：

```text
SKHYUSDT fundingRate = 0.0500%
SKHYNIXUSDT fundingRate = -0.0100%
combinedFundingRate = 0.0600%
每 1 万 USDT 名义仓位理论收取 6 USDT
```

## 当前数据源

公开行情版使用 Binance USD-M Futures 公共 REST：

- K 线：`GET /fapi/v1/klines`
- 资金费率历史：`GET /fapi/v1/fundingRate`
- 标记价格/最近资金费率：`GET /fapi/v1/premiumIndex`

当前页面展示的是公开数据推导的理论资金费，不等于账户实际到账。

## 实际收取记录

如果要统计真实到账，需要接 Binance 账户鉴权接口的 income history，筛选：

```text
incomeType = FUNDING_FEE
symbol in (SKHYUSDT, SKHYNIXUSDT)
```

建议记录字段：

| 字段 | 说明 |
| --- | --- |
| fundingTime | 资金费结算时间 |
| symbol | 交易对 |
| side | 仓位方向 |
| notionalUsdt | 当期名义仓位 |
| fundingRate | 当期资金费率 |
| theoreticalIncomeUsdt | 理论资金费 |
| actualIncomeUsdt | Binance 实际入账 |
| diffUsdt | 实际与理论差异 |

后续接入只读 API key 后，可以把公开理论值和账户实际 income history 做逐期核对。
