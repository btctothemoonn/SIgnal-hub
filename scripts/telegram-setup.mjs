import process from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const SESSION_FILE = ".telegram-login-state.json";

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

function getEnv(name, defaultValue = "") {
  return process.env[name]?.trim() || defaultValue;
}

async function loadState() {
  try {
    const content = await fs.readFile(SESSION_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveState(state) {
  await fs.writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
}

async function checkSession(apiId, apiHash, sessionString) {
  if (!sessionString) return false;

  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 3 }
  );

  try {
    await client.connect();
    const authorized = await client.checkAuthorization();
    await client.disconnect();
    return authorized;
  } catch {
    try {
      await client.disconnect();
    } catch {}
    return false;
  }
}

async function main() {
  const apiId = Number(getEnv("TELEGRAM_API_ID"));
  const apiHash = getEnv("TELEGRAM_API_HASH");

  if (!apiId || !apiHash) {
    console.error("❌ 请先在 .env.local 中配置 TELEGRAM_API_ID 和 TELEGRAM_API_HASH");
    process.exitCode = 1;
    return;
  }

  const state = await loadState();
  const existingSession = getEnv("TELEGRAM_SESSION") || state.session || "";

  console.log("🔍 检查现有 session...");
  const isValid = await checkSession(apiId, apiHash, existingSession);

  if (isValid) {
    console.log("✅ 当前 session 有效，无需重新登录！");
    console.log("\nTELEGRAM_SESSION=");
    console.log(existingSession);
    return;
  }

  console.log("⚠️  需要重新登录\n");

  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  const rl = createInterface({ input, output });

  try {
    await client.start({
      phoneNumber: async () => {
        return await rl.question("📱 Telegram 手机号（含国家码，如 +8613800138000）：");
      },
      phoneCode: async () => {
        return await rl.question("🔢 验证码：");
      },
      password: async () => {
        return await rl.question("🔐 两步验证密码（没有直接回车）：");
      },
      onError: (error) => {
        console.error("❌ 登录错误：", error.message);
      },
    });

    const newSession = client.session.save();
    await saveState({ session: newSession, updatedAt: new Date().toISOString() });

    console.log("\n✅ 登录成功！\n");
    console.log("TELEGRAM_SESSION=");
    console.log(newSession);
    console.log("\n📝 请将上面的值复制到 .env.local 的 TELEGRAM_SESSION");
  } finally {
    rl.close();
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error("❌", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

