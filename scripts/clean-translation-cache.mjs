import { DatabaseSync } from "node:sqlite";
import { cleanTranslationText } from "../src/lib/translate.ts";

const specs = [
  [".signal-hub/telegram-pipeline.sqlite", "telegram_messages", "id"],
  [".signal-hub/x-pipeline.sqlite", "x_feed", "id"],
];

for (const [path, table, idColumn] of specs) {
  const db = new DatabaseSync(path);
  const rows = db
    .prepare(
      `select ${idColumn} as id, translation_json from ${table} where translation_json is not null`,
    )
    .all();
  const update = db.prepare(
    `update ${table} set translation_json = ?, updated_at = datetime('now') where ${idColumn} = ?`,
  );
  let changed = 0;
  const remaining = [];

  for (const row of rows) {
    let parsed;
    try {
      parsed = JSON.parse(row.translation_json);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed.text !== "string") {
      continue;
    }

    const text = cleanTranslationText(parsed.text);
    if (text && text !== parsed.text) {
      parsed.text = text;
      update.run(JSON.stringify(parsed), row.id);
      changed += 1;
    } else if (/<think>|&lt;think&gt;/i.test(parsed.text)) {
      remaining.push(row.id);
    }
  }

  db.close();
  console.log(
    `${path} ${table} cleaned=${changed} remaining=${remaining.slice(0, 10).join(",")}`,
  );
}
