# 翻译健康与失败退避

翻译只用 MiniMax-M3（`src/lib/translate.ts`）。X（985 补译、6551 异步翻译）和 Telegram 共用同一套逻辑与 `translation-cooldown.sqlite`。

## 关闭推理（thinking）

MiniMax-M3 默认先推理再输出。长文本会把 `max_tokens` 全部用在推理上，返回 `finish_reason: "length"`，没有译文。2026-11-28 实测：1572 字推文在 2048 和 8192 token 下都只有推理、没有译文；关闭推理后 377 token、约 10 秒完成，质量正常。

- 请求默认带 `thinking: { type: "disabled" }`。需要恢复时设 `AI_TRANSLATION_THINKING=enabled`。
- `AI_TRANSLATION_MAX_TOKENS` 可调，默认 2048。
- `finish_reason: "length"` 记为 `truncated` 失败，不会写入半截译文。

## 按文本失败退避

模型对某条文本给不出可用译文（`unusable_output`、`truncated`、`timeout`）时，同一条文本重试也会一直失败。为此按「目标语言 + 原文」记录在 `translation-cooldown.sqlite` 的 `text_failure` 表，退避间隔依次为 5 分钟、30 分钟、2 小时、12 小时，之后每天最多重试一次；成功后清除记录。所有 worker 共享这张表。

- 退避期间不发请求。X 补译统计记为 `deferred`，Telegram 补译日志里也记为 `deferred`，都不算新失败。
- 额度、限流、鉴权、网络错误与文本无关，继续走全局冷却（`cooldown` 表），不计入按文本退避。
- 查看当前退避中的文本：`SELECT failures, last_failure, datetime(retry_at_ms/1000,'unixepoch') FROM text_failure ORDER BY updated_ms DESC LIMIT 20;`

## 是否需要翻译、译文是否可用

规则在 `src/lib/translation-quality.ts`：

- 钱包/合约地址（`0x` + 十六进制）不算外文；只有话题标签（`#Tag`）是外文时也不翻译。
- 英文原文、中文译文时，按「英文词数」与「汉字数 / 1.5」比较完整度，不再直接比字符数。之前完整的短句中文译文会因为「字符太少」被误判为不完整。双语原文只按其中英文部分计算。

## 6551 统计字段

`x_6551_translation` 事件里，`superseded` 表示已生成译文，但写入前这条推文已被其他来源（通常是 985 同时收到的版本）改了正文，写入被放弃。这一般是 985 与 6551 同时收到同一条推文造成的，不等于翻译丢失。

## 4 小时巡检

`scripts/check-translation-health.mjs` 由 `signal-hub-translation-watch.timer` 每 4 小时运行，单元文件在 `deploy/systemd/`（部署脚本不管理它，需手动安装，命令见 service 文件开头注释）。脚本从活动 release 运行，逻辑会随正常发布更新。

检查内容：985、x-pipeline、telegram 三个 worker 是否运行，凭据，全局冷却，985 最近 15 分钟是否有活动，以及最近 4 小时各 worker 的成功数、按原因分类的失败数和退避中的文本数。

结果为一行 JSON，状态有 `ok`、`worker_inactive`、`key_missing`、`long_cooldown`、`no_worker_activity`、`failing_without_progress`（失败 ≥10 且无成功）、`excessive_failures`（失败超过 `TRANSLATION_HEALTH_MAX_FAILURES`，默认 60）。非 `ok` 时退出码为 1，单元会显示为 failed。

```bash
journalctl -u signal-hub-translation-watch.service -n 5 --no-pager
```
