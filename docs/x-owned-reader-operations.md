# 自有X账号补采运行说明

正式采集由 Linux VPS 的 `signal-hub-x-owned-reader` 服务独立运行，Windows 电脑无需保持开启。种子名单与网站关注名单取交集，确认漏收后才会迁入 VPS；新关注默认 985。当前分流数量以 `/api/x/coverage` 为准，旧的「7 位 VPS、42 位 985」只是初期名单。博主静默、整个 985 源故障和账号限流不会触发切换。

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

原文先入库，翻译异步补齐；翻译模型失败不会阻塞主帖采集。未设置 `X_OWNED_READER_INTERVAL_MS` 时按开始到开始每 10 分钟调度；显式更小的值不会低于 5 分钟。生产环境自 2026-11-12 起设为 960000（16 分钟），不要再改回 5 或 10 分钟。原因：X 按接口、每 15 分钟一个固定窗口计配额，UserTweets 约 50 次/窗口；每轮对每位作者至少请求一次主帖，作者数为 N 时，间隔短于 15 分钟会让两轮落进同一窗口，需要 2N 次。11-11 至 11-12 在 10 分钟间隔、28 位作者下，132 轮中有 65 轮在第 25–29 次请求时被限流。间隔不少于 15 分钟时每个窗口只有一轮，主帖和回复（UserTweetsAndReplies，另一个配额）都能在 80 次预算内跑完，软冷却也会自动关闭。作者数接近 50 时需要重新评估（要么把部分作者交回 985，要么继续拉长间隔），不能靠并发或换账号绕过。twscrape 0.20.1 在响应头显示配额剩余 0 时会自己丢弃该页并锁定账号，所以桥接层同样在这时停止，不尝试保留该页。实际网络请求至少间隔 2 秒，最多 80 次/轮、180 秒截止、每作者最多 5 页。首次只回补最近 48 小时；后续从已覆盖上界前 15 分钟重叠，不做全历史抓取。

每轮先检查首位正式补采作者的主帖及引用，再执行有上限的对账，然后查其余正式补采作者，最后用剩余请求和页数补正式作者回复。回复覆盖不完整时不要为了补齐而提高频率或并发。主进度覆盖主帖及引用；可确认的回复独立补充。未知对话模块和预览先按具体ID核实canonical作者与原始发布时间，不能按模块到达时间伪造新帖；无法核实或预算不足时显示不完整，不宣称全部回复已覆盖。原生转发的独立事件暂不纳入自有采集首版。

覆盖范围为当前会话可读取的公开正文。详情接口确认“Subscribe to unlock”并链接该作者官方订阅入口的内容会单独排除，覆盖接口列出 `subscriberContentExcluded` 和 `subscriberExcludedTweetIds`，系统健康提示付费正文未覆盖；截断预览不会成为完整推文。其他未确认预览仍阻止推进窗口进度。

### 按活跃度分档检查

`X_OWNED_READER_ACTIVITY_TIERS=true` 时，按本站 `x_feed` 里该作者最近 7 天的帖子数分档：6 小时内发过帖或 7 天不少于 21 条，每轮检查；7 到 20 条，每 2 轮检查一次；少于 7 条，每 3 轮检查一次。间隔 16 分钟时，分别是 16、32、48 分钟。作者一发帖就会在 6 小时内回到每轮检查。从未检查、上一轮不完整、有待补窗口或待重试的作者每轮都查。采集进程重启后的第一轮查全部作者，部署 readiness 的抽样因此不受影响；之后才开始跳过低频作者。低频作者的逾期判定按各自的检查周期放宽，覆盖接口逐作者给出 `checkRounds`，日志 `deferredQuiet` 是本轮跳过的人数。默认关闭；设为 `false` 并重启采集服务即恢复每轮全查。代价是低频作者沉默后的第一条帖子最多晚约 48 分钟入库。

## 失效、暂停和回滚

限流遵循服务端reset并保留冷却；登录失效/挑战暂停，更新私有会话后再恢复，不能轮换账号绕过。网络和结构错误不当作“没有新帖”。关注列表中已取消的博主下轮不再查询。

冷却文件或控制表里的暂停未到期时，本轮在准备账号之前返回，不调用 bridge，也不把作者标成 connecting。调度器睡到 `nextRetryAt`（加 1 秒抖动）。成功轮请求数达到预算 70% 且调度间隔短于 15 分钟时，默认再写一段 `rate_budget_soft_cooldown`，时长为 `max(minIntervalMs, min(intervalMs, 12min))`；`X_OWNED_READER_SOFT_COOLDOWN=false` 可关闭。只写带 `nextRetryAt` 的临时暂停。

逾期阈值默认 `max(10min, intervalMs + 12min)`，可用 `X_OWNED_READER_STALE_AFTER_MS` 覆盖。成功检查时间和实际覆盖上界都参与判定，刚扫完的旧窗口不算当前覆盖。限流类全局暂停期间，已有有效成功检查的作者只多给一个调度间隔的宽限，超出后仍算 stale。coverage 用 `counts.cooling` 独立标记等待；健康汇总使用 coverage 已经算好的 `stale`。从未成功或时间戳无效的作者仍算逾期。

连续 5 次（`X_OWNED_READER_STRUCTURAL_ISOLATE_AFTER`）`unknown_conversation_module` 或 `timeline_structure_unrecognized` 后，该作者跳过本轮，原因记为 `structural_isolated`，默认 6 小时（`X_OWNED_READER_STRUCTURAL_RETRY_MS`）后再试一次。coverage 用 `structuralIncomplete` 单列，不计入普通 incomplete。一次完整成功会解除隔离。手动解除只清该作者的 `next_retry_at` 并降低 `incomplete_count`，不要清共享库或其他表。

发布采用现有原子release流程。启用时必须通过doctor和web认证readiness。readiness 只在进程不可用、会话不可用、配置缺失，或抽样作者首检失败时回滚：抽样为已分配的种子 7 位全部在激活后完成检查，或全部非结构作者至少 80% 完成。`structural_isolated` 与已知结构失败、以及全局 `rate_limited` / 冷却类暂停只告警，不回滚已构建的包。失败仍回滚旧release并停止旧版没有的新服务。会话、冷却、检查点、来源观测和已入库推文保留，数据库只增加兼容表/列。

第一次采集通过只证明当前轮可用。24小时稳定性、限流和真实新帖延迟需要后续观察，不能由一次空结果或服务active推断。

## 低频985对账与自动补采

开启 X_985_AUDIT_ENABLED 后，按自有读者轮次每轮最多检查一位985作者，避免同一小时的整批对账被主采耗尽预算。疑似漏帖至少10分钟后复查。正常轮查按最近尝试时间轮转；不完整窗口或未检查作者不能宣称已覆盖。首次审计最近8小时，后续从独立X检查点前15分钟重叠；疑似帖子保留复查下界，最多48小时。

对账在985连续连接至少10分钟且心跳新鲜时排队。重连或超过3分钟的心跳中断会开启新的观测区间，区间用于判断能否确认985漏收。独立读取仍可补回订阅后、最近48小时内的已验证原帖，包括重连前的已知缺口。完整检查发现本站缺少的原帖即写入，同一 ID 去重。补回后，只有两次符合985观测证据要求的检查才能迁移作者。

巡检与正式采集共用一个Python进程、一个80请求/180秒/2秒间隔预算门，SDK详情、作者ID解析与重定向也计入。对账放在首位主采作者之后，最多使用总预算中的6次请求；有当前985名单证据时优先首查只有VPS负责的作者。普通轮次日志requests列出实际请求总数。Linux私有会话旁有600权限.reader.lock，重复进程不发请求。限流和认证挑战仍全局暂停；对账本地额度用完只标记该次对账不完整。

长期冻结的自有采集窗口超出48小时回补范围后，会重新从最近48小时开始，不再重复扫描已不可达的旧窗口。旧检查点不会被当作完成；覆盖接口返回 `historyGapFromAt` / `historyGapThroughAt`，系统健康继续显示未核实历史缺口。新窗口验证成功也不会删除缺口或历史推文。旧窗口的结构隔离不阻挡新窗口的首次尝试；新窗口仍解析失败时照常计数和隔离。

985原始事件在过滤、正文解析和翻译前记录ID，媒体空正文也能证明已经收到。只在独立X主帖完整、原始ID/作者/时间验证、无私密标志、985连续SSE在线覆盖原始发帖时段且最近3分钟有活动、上游配置及REST正常、两次完整检查相隔至少10分钟仍无该ID的上游/raw/来源证据时，将作者写入x_985_promotions。未知上游事件结构阻止相关时段确认；付费正文、原生转发、未核实预览不作为确认漏收证据。

迁移名单位于生产SQLite，跨重启和部署保留，不改Cookie或env作者列表，不自动反复切回985。迟到的985事件仍按原始ID合并。覆盖API逐作者audit包含最后尝试、完整检查、状态、具体缺帖ID、迁移时间。若985收到但本站没入库，记local_processing，不把作者错误转入VPS。运维可调用 `request985PostRecheck` 提交已核实的公开帖子 ID，下一次常规轮转优先检查一次。人工报告不计为独立确认，也不增加每轮请求预算。

6551已关闭请求中央入口，前台积分/授权/补漏控件隐藏，部署停旧hybrid/pipeline服务；历史数据不删除，标注6551历史。此前可用缓存仍参与引用合并和翻译，不继续请求6551补全文。
