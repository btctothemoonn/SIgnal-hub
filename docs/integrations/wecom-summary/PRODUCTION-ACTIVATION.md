# 企微生产启用交接

日期：2026-09-07。用户已明确授权直接部署、启用真实同步，并要求企微总结免密码查看。该授权取代先前“仅合成、不部署”的阶段限制。

## Windows 实际上线回执

- 已推送 GitHub `main` 和 `codex/wecom-v2-receiver`，正式代码提交 `9b4823eafeaf163062b6761acfb21fc0e2151a4b`（包含接收实现 `4c93dc9`）。
- VPS 正式 release：`/home/ubuntu/signal-hub-releases/9b4823e-wDBXwFZA`，2026-09-07 01:25（Asia/Shanghai）启用。原 release `a5ac4ed-xqo5hdd1` 保留用于回滚。
- Windows、VPS 各 223 个测试文件通过；VPS Linux 隔离发布/开关/失败回滚测试通过；类型检查、ESLint 和正式 Next 构建通过。
- 公网 `/wecom` 及三个读 API 无登录返回 200；桌面 1440x1000、手机 390x844 Chrome 验证通过，无页面异常或横向溢出。持仓和设置页面仍 307，实际币安持仓 API 仍 401。
- 无签名写入 401；使用真实专用签名发送无效版本只返回 `400 unsupported_schema`，证明已到达正确验证链路，未写入测试报告/假心跳。
- `signal-hub-web` 与 `signal-hub-wecom-receiver` 均 active；接收器 enabled、仅 127.0.0.1:3041、内存上限 192 MiB、CPU 25%，检查时约 46 MiB、重启次数 0。
- **网站已上线并允许接收，不等于 Mac 已启用。** 检查时 `configured=true`、`connection=waiting`、`lastSeenAt=null`；报告和 CA 均为 0。未收到真实 Mac 心跳，不能声称完整生产同步成功。
- 专用配置已在 VPS 私密文件和 Windows 私密交接包准备好；不在 GitHub。下一步由 Mac Codex 按下节启动，不再重复请求用户许可。

## 网站变化

- `WECOM_PUBLIC_READ=true` 时，`/wecom` 和报告、CA、状态三个读取接口免登录；保留群名、昵称、完整结构化总结、来源元数据。
- 不开放持仓、设置、其他页面/API。写入口仍是专用 HMAC，只接服务器绑定设备；不上传原始聊天、附件、AI 密钥，不改 v2 字段。
- 公开页面仍禁止共享缓存，并发送 `noindex, noarchive` 提示；这些提示不是密码保护，知道地址的访客可以读取企微内容。
- VPS 部署脚本自动维护独立 `signal-hub-wecom-receiver` 服务：127.0.0.1:3041、开机启动、失败重启、192 MiB 内存上限、25% 单核 CPU 配额。
- 数据位于 `/home/ubuntu/signal-hub/.signal-hub/wecom/store.sqlite`，与现有业务分库。滚动发布仍先构建验证、再切换，并保留旧版本回滚。

## Mac Codex 执行

用户已批准启用，不再重复询问上线许可。保留现有监听与 AI 总结进程，不改群配置、模型、调度、历史数据库；只启动独立同步器。

1. 保留 Mac 已通过 47 项联调的代码及修复，核对 `4c93dc9` 回执；不要回退到旧仓库提交。网站后续公开读取变化不改变上传协议。
2. 通过用户提供的私密配置文件或已有 VPS SSH 读取 `/home/ubuntu/signal-hub/secrets/wecom/signalhub-sync.json`。该文件包含 `url/deviceId/secret`，**不提交 Git、不粘贴到公开文档/日志、不生成公开下载 URL**。
3. 已存在真实生产队列则保留其 store ID、水位与未确认项，不重新初始化、不更换设备。若只有合成测试队列，不可将测试队列复用为生产。
4. 首次生产启用使用独立目录 `~/Library/Application Support/wxFomo LAN/signalhub-sync-production/`，目录 0700；把私密配置安装为 `config.json`，文件 0600。新建 `outbox.sqlite3` 时生成并保存独立 store UUID，绑定配置内设备 `mac-wecom`。网站不要求特定 store UUID，不需要把它回传网站。
5. 根据现有运行配置确认真实 `messages.sqlite3`、`analysis.sqlite3` 路径，避免误连合成库。运行现有 `wxfomo-signal-sync.py --initialize`，显式指定 `--store`、`--messages`、`--analysis`、`--config`、`--store-id`，冻结当前双水位，只同步之后的新数据。已有真实队列跳过初始化。
6. 用现有 `--render-launch-agent` 输出独立 `com.wxfomo.signal-sync` 配置，复用同一组绝对路径和 UUID；将 `RunAtLoad` 与 `KeepAlive` 设为 true，增加合理 `ThrottleInterval`，用当前用户 LaunchAgent 启动。只处理该同步服务，不重启监听或 AI 服务。
7. 验证 HTTPS POST 返回持久确认，重试与队列无异常；等待真实心跳出现在 `/api/wecom/status`。状态来源是 Mac 实际进程证据，不伪造在线心跳。新报告生成后验证网站完整展示；CA 只有真实满足条件后才出现，空列表不等于失败。

Windows 当前只具备 VPS 连接，没有 Mac 远程执行通道。不能把网站上线、凭证生成或合成测试说成 Mac 真实同步已启动。

## 回执要求

网站端实际 release、公网免密码 HTTP 状态、无签名写入拒绝、其他页面仍授权、接收器运行及资源限制由 Windows 上线验证回填。Mac 侧回传同步服务状态、首个真实心跳时间、首次真实报告确认时间和固定错误码；不要附密钥或原始聊天。
