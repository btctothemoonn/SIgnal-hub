# Telegram 接入优化指南

## 优化内容

1. **统一登录脚本** - 使用 `npm run telegram:setup` 一键完成
2. **自动验证检查** - 启动前自动检查 session 是否有效
3. **自动重连机制** - 连接失败自动重试 3 次
4. **Session 持久化** - 保存到本地文件，避免重复验证

## 快速开始

### 1. 申请 API 凭据

访问 https://my.telegram.org 创建应用，获取：
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`

### 2. 配置环境变量

在 `.env.local` 中添加：

```env
TELEGRAM_API_ID=你的API_ID
TELEGRAM_API_HASH=你的API_HASH
TELEGRAM_CHANNELS=@au_call,@durov
```

### 3. 运行登录脚本

```bash
npm run telegram:setup
```

脚本会：
- ✅ 自动检查现有 session 是否有效
- ✅ 如果有效，直接显示无需重新登录
- ✅ 如果无效，引导你完成登录
- ✅ 自动保存 session 到本地

### 4. 复制 Session

将输出的 `TELEGRAM_SESSION` 值复制到 `.env.local`

## 常见问题

### Session 失效怎么办？

直接运行 `npm run telegram:setup`，脚本会自动检测并引导重新登录。

### 如何减少验证次数？

- ✅ 不要频繁删除 `.telegram-login-state.json` 文件
- ✅ 保持 `.env.local` 中的 `TELEGRAM_SESSION` 不变
- ✅ 使用优化后的脚本，会自动检查有效性

### 连接异常怎么办？

优化后的代码会自动重试 3 次，每次间隔 2 秒。如果仍然失败，检查：
- 网络连接是否正常
- API_ID 和 API_HASH 是否正确
- Session 是否过期（运行 `npm run telegram:setup` 重新登录）
