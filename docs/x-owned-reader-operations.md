# 自有X账号补采运行说明

正式采集由Linux VPS的 `signal-hub-x-owned-reader` 服务独立运行，Windows电脑无需保持开启。首版固定补采7位，与网站关注名单取交集；其余当前42位沿用985。新关注默认985，补采分组不因安静或整个985源临时故障自动扩大。

## 配置与私有数据

VPS私有 `.env.local` 使用以下非凭据配置：

```dotenv
X_OWNED_READER_ENABLED=true
X_OWNED_READER_PYTHON=/home/ubuntu/signal-hub-owned-reader-pilot/venv/bin/python
X_OWNED_READER_SESSION_DB=/home/ubuntu/signal-hub-owned-reader-pilot/accounts.db
X_OWNED_READER_COOLDOWN_FILE=/home/ubuntu/signal-hub-owned-reader-pilot/cooldown.json
X_OWNED_READER_USERNAMES=Hzzzz666,PhotonCap,woody168888,fi56622380,chaoxiangooo,1kbxx,fffffiyes_yu
```

会话数据库留在仓库外，目录权限700、文件600；源码和协议不包含Cookie。依赖固定 `twscrape==0.20.1`，复用已验证的隔离虚拟环境。默认功能关闭；`X_OWNED_READER_ENABLED=false` 后下一次正常部署停用该服务。不要同时运行临时probe和正式服务。

## 查询与验证

```bash
node --experimental-strip-types --experimental-transform-types scripts/x-owned-reader-worker.mjs --doctor
systemctl is-active signal-hub-x-owned-reader
journalctl -u signal-hub-x-owned-reader -n 30 --no-pager
```

doctor只检查协议、Python/SDK版本和会话可用性，不发X请求，不打印会话值。已登录网站管理员可读取 `/api/x/coverage`，核对49位来源、7位最后完整检查、回复覆盖及异常。来源标签为“X · 自有采集”，同ID多来源只显示一条。

原文先入库，翻译异步补齐；翻译模型失败不会阻塞主帖采集。每5分钟按开始到开始调度，实际网络请求至少间隔2秒，最多80次/轮、180秒截止、每作者最多5页。首次只回补最近48小时；后续从已覆盖上界前15分钟重叠，不做全历史抓取。

每轮先检查全部7位的主帖及引用，再用剩余请求和页数补回复，避免单个作者的回复耗尽预算。主进度覆盖主帖及引用；可确认的回复独立补充。未知对话模块和预览先按具体ID核实canonical作者与原始发布时间，不能按模块到达时间伪造新帖；无法核实或预算不足时显示不完整，不宣称全部回复已覆盖。原生转发的独立事件暂不纳入自有采集首版。

覆盖范围为当前会话可读取的公开正文。详情接口确认“Subscribe to unlock”并链接该作者官方订阅入口的内容会单独排除，覆盖接口列出 `subscriberContentExcluded` 和 `subscriberExcludedTweetIds`，系统健康提示付费正文未覆盖；截断预览不会成为完整推文。其他未确认预览仍阻止推进窗口进度。

## 失效、暂停和回滚

限流遵循服务端reset并保留冷却；登录失效/挑战暂停，更新私有会话后再恢复，不能轮换账号绕过。网络和结构错误不当作“没有新帖”。关注列表中已取消的博主下轮不再查询。

发布采用现有原子release流程。启用时必须通过doctor、web认证readiness及每个补采作者的首轮完整主帖检查；失败回滚旧release并停止旧版没有的新服务。会话、冷却、检查点、来源观测和已入库推文保留，数据库只增加兼容表/列。

第一次采集通过只证明当前轮可用。24小时稳定性、限流和真实新帖延迟需要后续观察，不能由一次空结果或服务active推断。
