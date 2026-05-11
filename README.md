# 信息面板 / Signal Hub

把 `Telegram`、`X`、`Jin10`、策略警报和多账户持仓聚合到同一个面板里的 Next.js 项目。

## 本地运行

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

## 接入 6551 的 X 数据

1. 到 [6551 MCP](https://6551.io/mcp) 申请 `TWITTER_TOKEN`
2. 复制一份环境变量模板
3. 启动项目后，首页的 `6551 X 实时流` 区块就会展示真实数据

```bash
copy .env.example .env.local
```

`.env.local` 里最关键的是这些变量：

```dotenv
TWITTER_TOKEN=你的6551Token
TWITTER_API_BASE=https://ai.6551.io
TWITTER_WS_URL=wss://ai.6551.io/open/twitter_wss
TWITTER_WATCH_USERNAMES=elonmusk,VitalikButerin
TWITTER_SEARCH_KEYWORDS=bitcoin,ethereum
```

说明：
- `TWITTER_TOKEN`：6551 的 Bearer Token
- `TWITTER_WATCH_USERNAMES`：本地补充要监控的 X 账号
- `TWITTER_SEARCH_KEYWORDS`：额外要盯的关键词
- `TWITTER_WS_URL`：6551 实时推送 WebSocket 地址

## 本地 API

项目里已经封装好了这些接口：

- `GET /api/x`
  读取 6551 的监控账号、账号推文和关键词搜索结果
- `POST /api/x`
  管理 watch 列表
- `GET /api/x/stream`
  服务端代理 6551 WebSocket，再通过 SSE 把实时事件推给浏览器
- `GET /api/telegram`
  读取 Telegram channel 历史快照
- `GET /api/telegram/stream`
  推送 Telegram 实时更新
- `GET /api/jin10`
  读取 Jin10 历史快讯快照
- `GET /api/jin10/stream`
  连接 Jin10 官方 WebSocket，再通过 SSE 推送实时快讯

## 接入 Telegram channel

这一版 Telegram 优先走 `MTProto 用户会话`：
- 更适合盯 `channel`
- 更适合做频道历史回补
- 可以读取当前登录账号已经加入的 public/private channel

### 1. 申请 Telegram 官方开发者凭据

到 [my.telegram.org](https://my.telegram.org) 创建应用，拿到：

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`

### 2. 生成会话串

先把 `TELEGRAM_API_ID` 和 `TELEGRAM_API_HASH` 写进 `.env.local`，然后运行：

```bash
npm run telegram:login
```

脚本会提示输入手机号、验证码和 2FA 密码，最后输出 `TELEGRAM_SESSION`。

### 3. 配置频道列表

```dotenv
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=your_string_session
TELEGRAM_CHANNELS=@durov,https://t.me/telegram
TELEGRAM_MESSAGES_PER_CHANNEL=3
TELEGRAM_FEED_ITEMS=12
TELEGRAM_TRANSLATE_ENABLED=true
TELEGRAM_TRANSLATE_TARGET=zh-CN
```

说明：
- `TELEGRAM_CHANNELS` 支持 `@username`、`t.me/...` 链接
- 私有频道的前提是当前登录会话本身已经加入该频道
- 图片、贴纸这类消息会尽量同步成面板里的预览图
- 外文文本会自动补一条中文“翻译备注”
- 页面会调用 `GET /api/telegram` 读取历史快照，再通过 `GET /api/telegram/stream` 收实时更新

## 接入 Jin10 快讯

这一版优先走 Jin10 Open Platform 的官方实时链路：
- `GET /api/jin10` 负责拉历史快照
- `GET /api/jin10/stream` 负责连接 Jin10 官方 WebSocket，再用本地 SSE 推给浏览器

先把 `.env.local` 补上这些变量：

```dotenv
JIN10_SECRET_KEY=你的Jin10OpenPlatform密钥
JIN10_REST_BASE=https://open-data-api.jin10.com
JIN10_WS_URL=wss://open-api-ws.jin10.com/flash
JIN10_FLASH_CATEGORIES=1,2,5
JIN10_FLASH_ITEMS_PER_CATEGORY=4
JIN10_FEED_ITEMS=12
JIN10_HIGHLIGHT_KEYWORDS=伊朗,Iran,以色列,Israel,中东,Middle East,霍尔木兹,Hormuz,德黑兰,Tehran
JIN10_TRANSLATE_ENABLED=true
JIN10_TRANSLATE_TARGET=zh-CN
```

说明：
- `JIN10_SECRET_KEY` 是 Jin10 Open Platform 的官方鉴权密钥
- `JIN10_FLASH_CATEGORIES` 默认先盯市场、期货、商品外汇三类，时效和相关性都更高
- `JIN10_HIGHLIGHT_KEYWORDS` 会把伊朗、中东、霍尔木兹这类词打上高亮，方便优先看会影响盘面的快讯
- 浏览器端会同时用 `SSE + 10 秒补拉`，避免因为单次断流漏掉关键消息
