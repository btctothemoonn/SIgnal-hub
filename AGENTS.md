<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 现行架构

Signal Hub 的 X 链路是 985 加 Linux VPS 自有读者。6551 请求已关闭，只保留历史来源标识。不要按旧 README 重新打开 6551 或 Jin10。企微同步和抖音采集默认不作为优先项。AI 只使用 MiniMax-M3，不要恢复 DeepSeek 或另加付费回退。Web Push 保留固定 VAPID，不要轮换密钥，也不要清空 `.signal-hub` 或 owned-reader 会话/冷却文件。`/intel` 每日投资简报使用独立新闻源，不能把 Signal 信息流复制成简报。

自有读者未设置 `X_OWNED_READER_INTERVAL_MS` 时默认 10 分钟，代码下限仍是 5 分钟。生产环境已经设为 600000。不要为了通过发布检查关掉读者或放宽 readiness。

## 完成汇报

每次完成工作时，主动明确说明验证结果、GitHub 推送状态和 VPS 部署状态。仅本地完成、仅推送仓库、部署进行中与已验证上线应分别说明；未核对 VPS 实际运行版本和服务健康时，不宣称部署完成。发布受阻时说明原因和下一步，不等用户追问。
