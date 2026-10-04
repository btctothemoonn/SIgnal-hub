# 自有X账号补采运行说明

正式采集由Linux VPS的 `signal-hub-x-owned-reader` 服务独立运行，Windows电脑无需保持开启。初始补采7位，与网站关注名单取交集；其余当前42位沿用985。确认逐作者漏收后自动增加VPS补采作者；新关注默认985。博主静默、整个985源故障和账号限流不会触发切换。

## 配置与私有数据

VPS私有 `.env.local` 使用以下非凭据配置：

```dotenv
X_OWNED_READER_ENABLED=true
X_985_AUDIT_ENABLED=true
TWITTER_CONNECTOR_ENABLED=false
X_HYBRID_ENABLED=false
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

doctor只检查协议、Python/SDK版本和会话可用性，不发X请求，不打印会话值。已登录网站管理员可读取 `/api/x/coverage`，核对49位路由、补采完整检查、回复覆盖和逐作者audit状态。来源标签为“VPS 采集”和“985 采集”，同ID多来源只显示一条。

原文先入库，翻译异步补齐；翻译模型失败不会阻塞主帖采集。每5分钟按开始到开始调度，实际网络请求至少间隔2秒，最多80次/轮、180秒截止、每作者最多5页。首次只回补最近48小时；后续从已覆盖上界前15分钟重叠，不做全历史抓取。

每轮先检查正式补采作者的主帖及引用，再检查当轮审计作者主帖，最后用剩余请求和页数补正式作者回复，避免单个作者的回复耗尽预算。主进度覆盖主帖及引用；可确认的回复独立补充。未知对话模块和预览先按具体ID核实canonical作者与原始发布时间，不能按模块到达时间伪造新帖；无法核实或预算不足时显示不完整，不宣称全部回复已覆盖。原生转发的独立事件暂不纳入自有采集首版。

覆盖范围为当前会话可读取的公开正文。详情接口确认“Subscribe to unlock”并链接该作者官方订阅入口的内容会单独排除，覆盖接口列出 `subscriberContentExcluded` 和 `subscriberExcludedTweetIds`，系统健康提示付费正文未覆盖；截断预览不会成为完整推文。其他未确认预览仍阻止推进窗口进度。

## 失效、暂停和回滚

限流遵循服务端reset并保留冷却；登录失效/挑战暂停，更新私有会话后再恢复，不能轮换账号绕过。网络和结构错误不当作“没有新帖”。关注列表中已取消的博主下轮不再查询。

发布采用现有原子release流程。启用时必须通过doctor、web认证readiness及每个补采作者的首轮完整主帖检查；失败回滚旧release并停止旧版没有的新服务。会话、冷却、检查点、来源观测和已入库推文保留，数据库只增加兼容表/列。

第一次采集通过只证明当前轮可用。24小时稳定性、限流和真实新帖延迟需要后续观察，不能由一次空结果或服务active推断。

## 低频985对账与自动补采

开启 X_985_AUDIT_ENABLED 后，每小时轮查7位985作者，当前42位在正常预算下约6小时覆盖一轮。疑似漏帖作者至少10分钟后定点复查，单轮最多2位，与小时轮查合计仍不超过7位。10分钟是漏收判断门槛，不是全名单轮查频率；不完整窗口或未检查的作者不能宣称当前全量覆盖。首次审计最近8小时，后续从独立X检查点前15分钟重叠；疑似帖子保留复查下界，最多48小时。

巡检与正式采集共用一个Python进程、一个80请求/180秒/2秒间隔预算门，SDK详情、作者ID解析与重定向也计入。普通轮次日志requests列出实际请求总数。Linux私有会话旁有600权限.reader.lock，重复进程不发请求；不要用临时probe并发抢正式会话。限流和认证挑战仍全局暂停；审计预算耗尽只标记审计不完整，不暂停已完整的正式主帖。

985原始事件在过滤、正文解析和翻译前记录ID，媒体空正文也能证明已经收到。只在独立X主帖完整、原始ID/作者/时间验证、无私密标志、985连续SSE在线覆盖原始发帖时段且最近3分钟有活动、上游配置及REST正常、两次完整检查相隔至少10分钟仍无该ID的上游/raw/来源证据时，将作者写入x_985_promotions。未知上游事件结构阻止相关时段确认；付费正文、原生转发、未核实预览不作为确认漏收证据。

迁移名单位于生产SQLite，跨重启和部署保留，不改Cookie或env作者列表，不自动反复切回985。已确认缺帖立即入库，后续正式5分钟补采；迟到985事件仍按原始ID合并。覆盖API逐作者audit包含最后尝试、完整检查、状态、具体缺帖ID、迁移时间。若985收到但本站没入库，记local_processing，应修复本站处理，不把作者错误转入VPS。

6551已关闭请求中央入口，前台积分/授权/补漏控件隐藏，部署停旧hybrid/pipeline服务；历史数据不删除，标注6551历史。此前可用缓存仍参与引用合并和翻译，不继续请求6551补全文。