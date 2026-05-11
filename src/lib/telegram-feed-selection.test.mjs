import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function item(id, channelUsername, minutesAgo, text = "message") {
  return {
    id,
    channelRef: channelUsername,
    channelTitle: channelUsername,
    channelUsername,
    channelId: channelUsername,
    text,
    createdAt: new Date(Date.UTC(2026, 3, 25, 12, 0 - minutesAgo, 0)).toISOString(),
  };
}

await test("selectTelegramFeed keeps 6551 monitor messages when global feed is capped", async () => {
  const { selectTelegramFeed } = await importTs("./telegram-feed-selection.ts");

  const noisy = Array.from({ length: 10 }, (_, index) =>
    item(`noisy:${index}`, "busy_channel", index),
  );
  const monitor = Array.from({ length: 3 }, (_, index) =>
    item(`monitor:${index}`, "xxxx6551monitor", 60 + index, "🌟监控到新推文"),
  );

  const selected = selectTelegramFeed([...noisy, ...monitor], {
    limit: 5,
    priorityMatchers: ["6551"],
  });

  assert.equal(selected.length, 5);
  assert.deepEqual(
    selected.filter((entry) => entry.channelUsername === "xxxx6551monitor").map((entry) => entry.id),
    ["monitor:0", "monitor:1", "monitor:2"],
  );
});

await test("isPriorityTelegramFeedItem matches 6551 monitor text even when channel name is generic", async () => {
  const { isPriorityTelegramFeedItem } = await importTs("./telegram-feed-selection.ts");

  assert.equal(
    isPriorityTelegramFeedItem(
      item("1", "generic_group", 1, "🌟监控到新推文\n你关注的用户: test"),
      ["6551"],
    ),
    true,
  );
});
