import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";

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

function getArg(index, label) {
  const value = process.argv[index]?.trim();
  if (!value) {
    throw new Error(`缺少参数 ${label}`);
  }

  return value;
}

async function main() {
  const phoneCode = getArg(2, "phoneCode");
  const maybePassword = process.argv[3]?.trim();
  const statePath = resolve(process.cwd(), ".telegram-login-state.json");
  const raw = await readFile(statePath, "utf8");
  const state = JSON.parse(raw);

  const client = new TelegramClient(
    new StringSession(state.sessionString || ""),
    Number(state.apiId),
    state.apiHash,
    {
      connectionRetries: 5,
    },
  );

  try {
    await client.connect();

    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: state.phoneNumber,
          phoneCodeHash: state.phoneCodeHash,
          phoneCode,
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "errorMessage" in error &&
        error.errorMessage === "SESSION_PASSWORD_NEEDED"
      ) {
        if (!maybePassword) {
          throw new Error("ACCOUNT_PASSWORD_NEEDED");
        }

        await client.signInWithPassword(
          { apiId: Number(state.apiId), apiHash: state.apiHash },
          {
            password: async () => maybePassword,
            onError: (err) => {
              throw err;
            },
          },
        );
      } else {
        throw error;
      }
    }

    console.log("");
    console.log("TELEGRAM_SESSION=");
    console.log(client.session.save());
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
