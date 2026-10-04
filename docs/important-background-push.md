# 重要后台通知

此功能通过浏览器 Web Push 显示系统通知。重要异动优先，重大新闻随后；不同有效事件没有每天、每小时条数上限，同一事件去重，只有阶段升级才再次提醒。新设备和重新开启的设备从当时的状态开始，不补发旧消息。

## 设备操作

Windows Chrome：登录网站，进入“设置 → 重要通知”，点击“开启通知”并允许权限。点击“发送测试通知”，确认系统中实际出现提醒。关闭网站标签页后 Chrome 进程仍须运行；检查 Windows 通知设置和专注模式。

iPhone：需要 iOS 16.4 或更新版本。在 Chrome 的分享菜单选择“添加到主屏幕”，从主屏幕图标打开网站并登录，再进入同一设置开启通知。普通 Chrome 标签页不能代替这个主屏幕应用。[Apple 平台说明](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)、[Chrome 添加到主屏幕说明](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS&hl=zh-Hans)。

每台设备独立管理。关闭通知或主动退出登录会撤销当前设备的服务端订阅；登录 Cookie 自然到期不会停止已启用设备的后台通知。通知内容可能出现在桌面或锁屏。网站重开后可刷新状态确认订阅，网络异常时不会把不确定的登记结果显示成成功。

## 服务器配置

默认 `WEB_PUSH_ENABLED=false`。启用前准备正式 HTTPS 站点和固定 VAPID 密钥对，保存在服务器私有配置中。不要将私钥提交、放入浏览器、发到聊天或输出到日志。

在服务器项目目录中一次性生成密钥并写入私有运行文件（已有文件时拒绝覆盖）：

```sh
pnpm exec node -e "const fs=require('node:fs');fs.mkdirSync('.signal-hub',{recursive:true});fs.writeFileSync('.signal-hub/web-push-vapid.json',JSON.stringify(require('web-push').generateVAPIDKeys()),{mode:0o600,flag:'wx'})"
```

将文件里的 publicKey/privateKey 分别填入 `WEB_PUSH_VAPID_PUBLIC_KEY` 和 `WEB_PUSH_VAPID_PRIVATE_KEY`；`WEB_PUSH_VAPID_SUBJECT` 设置为有效 `mailto:` 联系地址或 HTTPS 联系页面。`SIGNAL_HUB_PUBLIC_ORIGIN` 填写正式 HTTPS origin，例如 `https://hub.example.com`，不含路径、查询参数或片段。最后设置 `WEB_PUSH_ENABLED=true`。

仅明确的本地开发/测试允许 localhost HTTP origin。订阅 endpoint 只接受 `fcm.googleapis.com` 和 `web.push.apple.com` 的 HTTPS 地址，不跟随重定向。VAPID 轮换需要设备重新订阅，并从新基线开始。

```sh
pnpm push:worker:once
pnpm push:worker
pnpm health:check
```

VPS 部署会按开关创建并运行 `signal-hub-web-push`；关闭时停止该可选服务并取消开机启动。已启用但配置错误会显示健康错误，超过 30 秒没有心跳会显示警告。认证失败不会在下一次空闲循环中被隐藏；成功投递后才清除此状态。提供商 accepted 表示接收请求，无法据此证明用户已看到通知。

## 数据与恢复

生产者 outbox 保存在原行情和简报数据库；设备、epoch、队列和领取租约保存在 `SIGNAL_HUB_RUNTIME_DIR/web-push.sqlite`。生产环境的运行目录位于 release 外，升级、重启和回滚不删除它。备份时使用 SQLite 备份工具，或停止相关写入进程后一起备份数据库及尚未 checkpoint 的 WAL 文件；不要只复制正在写入的主数据库。订阅数据库与 VAPID 私钥都按私密数据管理。

进程重启会恢复仍有效的 pending/retry 和过期租约。异动两分钟、新闻待发一小时后过期，不补发过时信号。已撤销设备的旧 epoch 不会恢复。每个发送请求都有至多十秒的总期限，消息过期或退出进程会提前销毁请求；提供商已经接受的消息无法撤回。回滚只重启旧 release 实际具有脚本的服务，缺少推送脚本时先停止并取消新推送服务的开机启动。

推送资格保留真实指标来源时间及连续 K 线区间，旧信号的重新计算不会刷新其来源时间；缺少时间证据时保守跳过推送，原网页评分保持不变。重要新闻通知保存对应的简报版本，点击后自动选择新闻所在分类，再定位到卡片；后续简报更新不会移除这一入口。

## 验证记录

本地单元测试使用临时 SQLite、固定时间和假传输，不调用真实行情、新闻、AI 或推送服务。桌面 1440 和手机 390 宽度的实际 Chrome 页面已检查，无手机横向溢出，操作可用键盘访问。

功能分支的 252 个测试文件通过。2026-10-03 合并到本地 main 后，主工作区共 254 个测试文件通过，lint 无警告、TypeScript 检查和隔离生产构建通过，两个实际 Chrome 用例通过。通知用例验证了开启、测试、关闭、退出及再登录后重新开启；使用 about:blank 控制页，关闭全部网站页面后，通过 CDP 向真实 Service Worker 注入模拟 push，真实 showNotification 可从新页面读取，标题、稳定 tag 和点击目标均正确。另一个用例验证了币圈和宏观新闻链接打开保存的简报版本、自动选择分类并显示目标卡片。

通知用例模拟 Google/Apple 投递入口，不代表 Windows 桌面或 iPhone 已真实收到通知。独立整分支审查提出五项重要问题，均以先失败后通过的回归测试修复，没有延期的小问题。2026-10-03 发布整合版本的 271 个测试文件、lint、类型检查和生产构建通过，五个实际 Chrome 用例通过；VPS Linux 临时目录中的完整发布回滚 fixture、Bash 语法和便携回滚状态测试也通过。生产固定密钥及启用配置已保存在服务器私有文件，未提交或输出密钥值。Windows 与 iPhone 的真实测试通知和重要事件仍须实机确认。

首次本地合并时，已有 13 个未提交文件保持原内容。用户随后授权推送部署，远端同步已恢复，线上后续更新在独立发布目录中整合。实际上线版本须以 `/home/ubuntu/signal-hub-current/.release-commit` 和服务健康检查确认；代码构建通过不等于设备已收到通知。

## 开启失败的排查

开启失败会显示安全错误码和失败步骤：通知授权、本地保存设备凭证、浏览器建立订阅、服务器登记、状态确认。提示不包含订阅地址、设备密钥或原始错误内容。刷新状态不会证明失败已恢复，须完成开启并实际收到测试通知。

2026-10-04 的一次真实连接测试由 Google 推送服务接受，用户确认 Windows 出现系统通知。iPhone 已从主屏幕应用打开，但尚未成功登记订阅，不能宣称其真实投递通过。自动通知没有发送记录时，应分别检查来源是否产生合格事件、outbox、设备基线和投递结果；worker 的正常心跳不能证明已经向设备发出消息。
