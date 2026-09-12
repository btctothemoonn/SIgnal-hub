# VPS 自动更新

由 VPS systemd timer 每 5 分钟检查 GitHub `origin/main`，不依赖本机、Codex 或 AI API。PR 未合并不更新。

- 只查询最新提交号；与正在运行的 release 相同就结束，不安装依赖或构建。
- 有更新才执行原部署流程：锁定、快进拉取、隔离安装/全量测试/检查/构建、切换、健康检查，失败保留或恢复旧 release。
- 手动与自动部署共享互斥锁；锁在修改 Git 检出之前获取。旧 release 名称和新 `.release-commit` 均可识别，不能误把构建失败后已更新的工作目录当作线上版本。
- CPU 上限半个核心，低调度优先级；内存软上限 1 GiB、硬上限 1.5 GiB、交换空间上限 1.5 GiB，Node 堆上限 1 GiB。资源紧张时构建可能变慢或失败，但无更新检查很轻。
- 可用磁盘少于 8 GiB 时停止部署，不自动删除 release、配置或数据。
- 一次部署最长 45 分钟，超时先终止并尝试回滚，2 分钟后强制结束残留构建进程。
- 失败/中断提交写入 `.signal-hub-auto-update-attempt`，后续不反复构建同一版本；新的 main 提交会重新尝试。手动部署占用锁不计为失败。
- 日志进入 systemd journal，不将密钥放进代码或日志。网站运行与接收服务保持原有独立 systemd 服务。

## 安装和操作

在 `/home/ubuntu/signal-hub` 执行 `bash scripts/install-auto-update-vps.sh`。

```bash
systemctl list-timers --all signal-hub-auto-update.timer
journalctl -u signal-hub-auto-update.service -n 80 --no-pager
sudo systemctl start signal-hub-auto-update.service
sudo systemctl disable --now signal-hub-auto-update.timer
```

失败后如需重试同一提交，可直接手动执行 `bash scripts/deploy-vps.sh`；成功后的版本标记会让定时检查恢复为无更新状态。不重置 Git，不覆盖服务器 `.env.local`、`secrets/` 或 `.signal-hub/`。

此机制仅更新 SignalHub 网站。Mac 的 `wecom-summary` 监听及总结程序不在更新范围内。
