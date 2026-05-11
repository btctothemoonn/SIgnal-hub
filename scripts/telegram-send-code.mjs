import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, "utf-8");
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

await loadEnvFile(resolve(process.cwd(), ".env.local"));
await loadEnvFile(resolve(process.cwd(), ".env"));

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
  const phoneNumber = process.argv[2]?.trim();
  if (!phoneNumber) {
    throw new Error("请把手机号作为第一个参数传入");
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.connect();

    const { phoneCodeHash, isCodeViaApp } = await client.sendCode(
      { apiId, apiHash },
      phoneNumber,
      false,
    );

    const statePath = resolve(process.cwd(), ".telegram-login-state.json");
    await writeFile(
      statePath,
      JSON.stringify(
        {
          apiId,
          apiHash,
          phoneNumber,
          phoneCodeHash,
          sessionString: client.session.save(),
          sentAt: new Date().toISOString(),
          isCodeViaApp,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          success: true,
          statePath,
          delivery: isCodeViaApp ? "app" : "sms",
        },
        null,
        2,
      ),
    );
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
