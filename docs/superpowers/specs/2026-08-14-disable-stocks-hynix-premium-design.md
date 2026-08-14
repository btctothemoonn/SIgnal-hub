# STOCKS 海力士溢价下线设计

## 目标

暂时关闭 STOCKS 页面中的海力士溢价曲线，同时完整保留 Signal 首页现有展示、提醒和数据能力。

## 范围

- 从 `AlphaResearchPage` 移除 `StocksHynixPremiumCurve` 的导入和渲染。
- 更新 STOCKS 页面契约测试，明确该页面不再挂载海力士溢价组件。
- 保留 `SignalsResponsiveLayout` 中的组件挂载。
- 保留共用组件、海力士溢价与资金费率 API、缓存、计算逻辑和测试。

## 数据流

STOCKS 页面不再实例化组件，因此不会为该功能发起浏览器请求。Signal 首页继续通过同一组件访问原有 API，行为不变。

## 验证

- STOCKS 页面源码和测试均确认不存在该组件挂载。
- Signal 首页测试继续确认组件位于信号流上方。
- 全量测试与生产构建通过。

