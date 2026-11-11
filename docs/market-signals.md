# 异动信号（/alerts 重做）

2026-11-11 起 `/alerts` 改为"信号看板"，旧页面保留在 `/alerts/legacy`。底层 WS / REST / 轧空采集、量比口径、冻结图、去重与 429 节流均未改动；新增的只是在这些事件和公开行情之上的规则层。

## 为什么重做

用生产库 2026-08-31 至 11-11 的 8329 条触发、487 个币的合约 15m K 线回放（入场取触发后下一根 15m 开盘价，收益按方向调整）：

| 情况 | 24h 中位 | 24h 胜率 |
| --- | --- | --- |
| 随机时点做多（基准） | -0.14% | 47% |
| 暴涨 L1 / L2 / L3 立即追 | -3.3% / -6.7% / -7.8% | 35–39% |
| 轧空 L1 / L2 / L3 做多 | -7.3% / -11.9% / -6.8% | 25–37% |

旧的"加速 / 轧空启动 → 关注做多"在这段数据里方向是反的。轧空条件逐项拆开（负费率、OI、多空比、主动买入、突破），没有任何一项能让结果转正。

## 新的三类信号

按时间分段验证：前 48 天找规则、后 24 天只验证；止损 8%、持有 24h、扣 0.1% 往返手续费，未计资金费。

### 1. 回调买点（推送）

暴涨触发，且触发前 24h 涨幅 < 10%；触发后 12h 内，价格从触发以来最高点回调 12% 时提示。参考价即回调价，止损 -8%，持有 24h。

| | 训练段 均值 / 胜率 | 验证段 均值 / 胜率 |
| --- | --- | --- |
| 立即追（对照） | +0.15% / 29% | -1.63% / 27% |
| 回调 12% | +1.83% / 31% | +1.78% / 29% |
| 24h 涨 <10% + 回调 12%（采用） | +4.64% / 40% | +3.82% / 35% |

在 5 种止损方式（8%、12%、无止损、2 倍和 4 倍波动）下两段均为正。中位数仍为负，靠少数大涨的单子盈利。

### 2. 蓄力（实验，不推送）

每小时整点后：OI 24h ≥ +30%，价格 4h 在 ±3% 内，24h 涨幅 < 10%。回测中先涨 15% 的有 9–30%，先跌 8% 的接近 0，但每段只有 5–22 个样本，不能下结论，先记录实盘结果。

### 3. 大波动预警（不推送，不标方向）

资金费率 ≤ -0.1%，或 OI 24h ≥ +30%。12h 内涨或跌 15% 的概率是平时的 3–9 倍，但涨跌各半，且多数 OI 暴增出现时价格已经先涨了一段。

### 暴跌方向

没有找到两段都稳定为正的做空规则，暴跌只展示不标"可空"。唯一一致的是：BTC 24h 已跌超 1.7% 时追空山寨币两段都亏，页面会显示警示。

## 实现

- `src/lib/market-signals.ts`：纯规则（`evaluatePullback`、`classifyPositioning`、`computeTradeOutcome`、`computeWatchOutcome`、`summarizeSignals`）与 `market-alerts/signals.sqlite` 存储，自带 Web Push outbox。
- `src/lib/market-signals-worker.ts`：挂在现有 `signal-hub-market-opportunity` 进程里，每 5 分钟一轮，不新增 systemd 服务：
  - 读最近 13h 的暴涨事件，每个币取一次 15m K 线判断是否回调到位（每轮最多 40 个币）。同一币 24h 内只开一笔。
  - 回调成交 30 分钟内被发现才推送；重启后补发现的只记录、不推送。
  - 补算 24h（回调买点）和 12h（两类预警）后的实际结果，每轮最多 20 个。
  - 每小时整点 3 分钟后，对日成交额 ≥ 500 万美元的合约取 1h K 线与 1h OI（约 160 个币、320 次请求，与其他行情 worker 共用限流），存入 `market_positioning_hourly`，保留 180 天。Binance 自身只保留 30 天，这份数据用于以后重新验证规则。
- Web Push 新增 `signals` 来源，接法与海力士溢价一致：独立 outbox、设备登记后才收到、TTL 30 分钟、`target=/alerts`。
- `/api/market-signals` 只读本地 SQLite，页面在 SSE 有更新时（最多 15 秒一次）和每 60 秒刷新一次。
- 页面每类信号都显示"实盘近 30 天"战绩与回测参考，规则失效时可以直接看出来。

## 可调参数（环境变量，均有默认值）

`MARKET_SIGNAL_PULLBACK_PCT`=12、`MARKET_SIGNAL_PULLBACK_WINDOW_HOURS`=12、`MARKET_SIGNAL_MAX_PRE24H_PCT`=10、`MARKET_SIGNAL_STOP_PCT`=8、`MARKET_SIGNAL_FILL_FRESH_MINUTES`=30、`MARKET_SIGNAL_VOLATILE_FUNDING_MAX`=-0.001、`MARKET_SIGNAL_VOLATILE_OI24H_PCT`=30、`MARKET_SIGNAL_COIL_OI24H_PCT`=30、`MARKET_SIGNAL_COIL_MAX_PX4H_PCT`=3、`MARKET_SIGNAL_COIL_MAX_PX24H_PCT`=10、`MARKET_SIGNAL_POSITIONING_MIN_QUOTE_VOLUME`=5000000、`MARKET_SIGNAL_BTC_SHORT_WARNING_PCT`=-1.7、`MARKET_SIGNALS_DB`（默认 `market-alerts/signals.sqlite`）。

## 局限

- 回测只覆盖约 72 天（持仓数据 30 天）、单一市场环境；同一币的连续触发不独立，有效样本少于表中数字。
- 未计资金费和滑点。暴涨币的资金费通常为正，做多要付费。
- 回测里的资金费用的是历史结算费率，线上用的是 `premiumIndex` 的当期费率，二者略有差异。
- 旧的 opportunity / squeeze 推送仍在运行，是否停用待确认。

调整规则前，先用同一套回测重跑（脚本思路见本文"为什么重做"一节：事件导出 + 15m K 线回放 + 时间分段验证）。
