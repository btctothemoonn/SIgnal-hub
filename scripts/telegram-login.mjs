import process from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

async function loadEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

await loadEnvFile(path.resolve(process.cwd(), ".env.local"));
await loadEnvFile(path.resolve(process.cwd(), ".env"));

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }

  return value;
}

async function main() {
  const apiId = Number(getRequiredEnv("TELEGRAM_API_ID"));
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID 必须是正整数");
  }

  const apiHash = getRequiredEnv("TELEGRAM_API_HASH");
  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  const rl = createInterface({ input, output });

  try {
    await client.start({
      phoneNumber: async () => {
        return await rl.question("Telegram 手机号（含国家码，例如 +86...）：");
      },
      phoneCode: async () => {
        return await rl.question("Telegram 验证码：");
      },
      password: async () => {
        return await rl.question("两步验证密码（没有就直接回车）：");
      },
      onError: (error) => {
        console.error("登录流程出现错误：", error);
      },
    });

    console.log("");
    console.log("TELEGRAM_SESSION=");
    console.log(client.session.save());
    console.log("");
    console.log("把上面的值写入 .env.local 的 TELEGRAM_SESSION 即可。");
  } finally {
    rl.close();
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
