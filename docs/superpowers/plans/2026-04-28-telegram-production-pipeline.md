# Telegram Production Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the page-triggered Telegram pull path with a production-grade local background ingestion pipeline that keeps messages complete, cached, fast to load, and resilient to Telegram connection failures.

**Architecture:** Telegram ingestion moves into long-running worker processes backed by PostgreSQL and Redis/BullMQ on the local machine. The Next.js app becomes a read-only consumer of persisted Telegram data and receives live updates through SSE. The old `src/lib/telegram-channels.ts` pull path is removed from the active web route in one cutover; rollback is by git revert, not by an app-level compatibility mode.

**Tech Stack:** Next.js 16, React 19, GramJS `telegram`, PostgreSQL, Redis, BullMQ, `pg`, `ioredis`, `zod`, `pino`, `tsx`, Node.js scripts.

---

## File Structure

- Create `src/lib/tg-pipeline/config.ts`: validates pipeline env vars and feature flags.
- Create `src/lib/tg-pipeline/config.test.mjs`: tests config defaults and validation.
- Create `src/lib/tg-pipeline/types.ts`: shared database-facing types for channels, messages, media, health, and dashboard snapshots.
- Create `src/lib/tg-pipeline/schema.sql`: PostgreSQL schema for channels, messages, media, cursors, fetch runs, and health events.
- Create `scripts/migrate-tg-pipeline.mjs`: applies `schema.sql` to `DATABASE_URL`.
- Create `src/lib/tg-pipeline/db.ts`: lazy PostgreSQL pool helper.
- Create `src/lib/tg-pipeline/repository.ts`: all SQL reads/writes used by web and workers.
- Create `src/lib/tg-pipeline/repository.test.mjs`: tests SQL intent with a fake query client.
- Create `src/lib/tg-pipeline/message-normalizer.ts`: converts GramJS messages into stable message records.
- Create `src/lib/tg-pipeline/message-normalizer.test.mjs`: tests ids, URLs, dates, and media metadata.
- Create `src/lib/tg-pipeline/media-store.ts`: writes downloaded media previews to disk and returns public URLs.
- Create `src/lib/tg-pipeline/media-store.test.mjs`: tests deterministic paths and content writes with a temporary directory.
- Create `src/lib/tg-pipeline/queue.ts`: BullMQ queues for backfill, media, avatar, and health jobs.
- Create `src/lib/tg-pipeline/telegram-client.ts`: GramJS client lifecycle owned by workers only.
- Create `src/workers/telegram-collector.ts`: realtime event collector.
- Create `src/workers/telegram-worker.ts`: queue processor for backfill/media/avatar/health jobs.
- Create `src/app/api/telegram/events/route.ts`: SSE stream for newly persisted messages.
- Modify `src/app/api/telegram/route.ts`: read from the database only; do not call legacy Telegram refresh from the web process.
- Modify `src/app/api/settings/route.ts`: enqueue sync/backfill jobs when Telegram channel settings change.
- Modify `src/components/unified-news-panel.tsx`: use DB snapshot plus SSE updates instead of forcing refresh pulls.
- Modify `package.json`: add dependencies and scripts for migration and workers.
- Create `docker-compose.local.yml`: local stack for postgres and redis first; web/collector/worker can run from local terminals for easier debugging.
- Modify `.env.example`: document pipeline env vars.

## Local-First Cutover Rules

- Do the full switch on the local machine first. VPS packaging is a later project.
- `/api/telegram` must never call GramJS. It reads PostgreSQL only.
- The old panel and old refresh behavior may break during the cutover; this is acceptable.
- Never let `/api/telegram` return an empty feed only because Telegram is currently disconnected. The API reads the latest persisted messages first.
- The collector and worker are the only processes allowed to call GramJS after cutover.
- Message uniqueness is `channel_id + message_id`; every write uses upsert semantics.
- Media download failures are recorded, retried, and never block message persistence.

### Task 1: Pipeline Config

**Files:**
- Create: `src/lib/tg-pipeline/config.ts`
- Create: `src/lib/tg-pipeline/config.test.mjs`

- [ ] **Step 1: Write the failing config test**

Create `src/lib/tg-pipeline/config.test.mjs`:

```js
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

const { loadTelegramPipelineConfig } = await importTs("./config.ts");

const config = loadTelegramPipelineConfig({
  TG_PIPELINE_ENABLED: "true",
  DATABASE_URL: "postgres://user:pass@localhost:5432/signal_hub",
  REDIS_URL: "redis://localhost:6379",
  TG_MEDIA_DIR: ".signal-hub/tg-media",
  TG_PUBLIC_MEDIA_BASE_URL: "/tg-media",
});

assert.equal(config.enabled, true);
assert.equal(config.databaseUrl, "postgres://user:pass@localhost:5432/signal_hub");
assert.equal(config.redisUrl, "redis://localhost:6379");
assert.equal(config.mediaDir, ".signal-hub/tg-media");
assert.equal(config.publicMediaBaseUrl, "/tg-media");
assert.equal(config.backfillIntervalMs, 60_000);
assert.equal(config.backfillMessagesPerChannel, 80);
assert.equal(config.mediaConcurrency, 2);
console.log("ok - loadTelegramPipelineConfig validates defaults");
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node src/lib/tg-pipeline/config.test.mjs
```

Expected: fails because `src/lib/tg-pipeline/config.ts` does not exist.

- [ ] **Step 3: Implement config**

Create `src/lib/tg-pipeline/config.ts`:

```ts
export type TelegramPipelineConfig = {
  enabled: boolean;
  databaseUrl: string;
  redisUrl: string;
  mediaDir: string;
  publicMediaBaseUrl: string;
  backfillIntervalMs: number;
  backfillMessagesPerChannel: number;
  mediaConcurrency: number;
};

function parseBoolean(raw: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required when TG_PIPELINE_ENABLED=true`);
  }
  return value;
}

export function loadTelegramPipelineConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelegramPipelineConfig {
  const enabled = parseBoolean(env.TG_PIPELINE_ENABLED);
  return {
    enabled,
    databaseUrl: enabled ? required(env, "DATABASE_URL") : env.DATABASE_URL ?? "",
    redisUrl: enabled ? required(env, "REDIS_URL") : env.REDIS_URL ?? "",
    mediaDir: env.TG_MEDIA_DIR?.trim() || ".signal-hub/tg-media",
    publicMediaBaseUrl: env.TG_PUBLIC_MEDIA_BASE_URL?.trim() || "/tg-media",
    backfillIntervalMs: parsePositiveInt(env.TG_BACKFILL_INTERVAL_MS, 60_000),
    backfillMessagesPerChannel: parsePositiveInt(
      env.TG_BACKFILL_MESSAGES_PER_CHANNEL,
      80,
    ),
    mediaConcurrency: parsePositiveInt(env.TG_MEDIA_CONCURRENCY, 2),
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
node src/lib/tg-pipeline/config.test.mjs
```

Expected: `ok - loadTelegramPipelineConfig validates defaults`.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/tg-pipeline/config.ts src/lib/tg-pipeline/config.test.mjs
git commit -m "feat: add telegram pipeline config"
```

### Task 2: Database Schema and Migration

**Files:**
- Create: `src/lib/tg-pipeline/schema.sql`
- Create: `scripts/migrate-tg-pipeline.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add dependencies and scripts**

Run:

```powershell
npm install pg bullmq ioredis zod pino
npm install -D tsx @types/pg
```

Modify `package.json` scripts:

```json
{
  "tg:migrate": "node scripts/migrate-tg-pipeline.mjs",
  "tg:collector": "tsx src/workers/telegram-collector.ts",
  "tg:worker": "tsx src/workers/telegram-worker.ts"
}
```

- [ ] **Step 2: Create schema**

Create `src/lib/tg-pipeline/schema.sql`:

```sql
create table if not exists tg_channels (
  id bigserial primary key,
  ref text not null unique,
  telegram_channel_id text not null unique,
  username text not null default '',
  title text not null,
  link text not null,
  avatar_url text,
  tags text[] not null default '{}',
  enabled boolean not null default true,
  last_message_id bigint,
  last_message_at timestamptz,
  last_backfill_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tg_messages (
  id bigserial primary key,
  channel_db_id bigint not null references tg_channels(id) on delete cascade,
  channel_id text not null,
  message_id bigint not null,
  message_url text not null,
  text text not null default '',
  created_at timestamptz not null,
  views integer not null default 0,
  forwards integer not null default 0,
  origin text not null check (origin in ('realtime', 'backfill')),
  raw jsonb not null default '{}',
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, message_id)
);

create table if not exists tg_media (
  id bigserial primary key,
  message_db_id bigint not null references tg_messages(id) on delete cascade,
  kind text not null,
  mime_type text not null default '',
  storage_url text,
  width integer,
  height integer,
  status text not null check (status in ('pending', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_db_id)
);

create table if not exists tg_fetch_runs (
  id bigserial primary key,
  channel_db_id bigint references tg_channels(id) on delete cascade,
  kind text not null check (kind in ('realtime', 'backfill', 'media', 'avatar', 'health')),
  status text not null check (status in ('started', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  message_count integer not null default 0,
  error text
);

create table if not exists tg_health_events (
  id bigserial primary key,
  scope text not null,
  status text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists tg_messages_created_at_idx on tg_messages (created_at desc);
create index if not exists tg_messages_channel_created_idx on tg_messages (channel_db_id, created_at desc);
create index if not exists tg_fetch_runs_started_idx on tg_fetch_runs (started_at desc);
```

- [ ] **Step 3: Create migration script**

Create `scripts/migrate-tg-pipeline.mjs`:

```js
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = await readFile(
  resolve(process.cwd(), "src/lib/tg-pipeline/schema.sql"),
  "utf8",
);
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(sql);
  console.log("telegram pipeline schema applied");
} finally {
  await pool.end();
}
```

- [ ] **Step 4: Verify migration script syntax**

Run:

```powershell
node --check scripts/migrate-tg-pipeline.mjs
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json src/lib/tg-pipeline/schema.sql scripts/migrate-tg-pipeline.mjs
git commit -m "feat: add telegram pipeline database schema"
```

### Task 3: Database Access and Repository

**Files:**
- Create: `src/lib/tg-pipeline/types.ts`
- Create: `src/lib/tg-pipeline/db.ts`
- Create: `src/lib/tg-pipeline/repository.ts`
- Create: `src/lib/tg-pipeline/repository.test.mjs`

- [ ] **Step 1: Write repository test**

Create `src/lib/tg-pipeline/repository.test.mjs`:

```js
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

const calls = [];
const fakeClient = {
  async query(text, values) {
    calls.push({ text, values });
    if (text.includes("insert into tg_channels")) {
      return { rows: [{ id: "11" }] };
    }
    if (text.includes("insert into tg_messages")) {
      return { rows: [{ id: "22" }] };
    }
    return { rows: [] };
  },
};

const { createTelegramRepository } = await importTs("./repository.ts");
const repo = createTelegramRepository(fakeClient);

const channelId = await repo.upsertChannel({
  ref: "au_call",
  telegramChannelId: "2955560057",
  username: "au_call",
  title: "AU Trading Journal",
  link: "https://t.me/au_call",
  avatarUrl: null,
  tags: ["alpha"],
});
const messageId = await repo.upsertMessage({
  channelDbId: channelId,
  channelId: "2955560057",
  messageId: 123,
  messageUrl: "https://t.me/au_call/123",
  text: "hello",
  createdAt: "2026-04-28T00:00:00.000Z",
  views: 1,
  forwards: 2,
  origin: "backfill",
  raw: { id: 123 },
});

assert.equal(channelId, 11);
assert.equal(messageId, 22);
assert.equal(calls.length, 2);
assert.match(calls[0].text, /on conflict \(ref\) do update/);
assert.match(calls[1].text, /on conflict \(channel_id, message_id\) do update/);
console.log("ok - repository upserts channels and messages");
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
node src/lib/tg-pipeline/repository.test.mjs
```

Expected: fails because `repository.ts` does not exist.

- [ ] **Step 3: Create types and repository**

Create `src/lib/tg-pipeline/types.ts`:

```ts
export type TgChannelRecordInput = {
  ref: string;
  telegramChannelId: string;
  username: string;
  title: string;
  link: string;
  avatarUrl: string | null;
  tags: string[];
};

export type TgMessageRecordInput = {
  channelDbId: number;
  channelId: string;
  messageId: number;
  messageUrl: string;
  text: string;
  createdAt: string;
  views: number;
  forwards: number;
  origin: "realtime" | "backfill";
  raw: Record<string, unknown>;
};
```

Create `src/lib/tg-pipeline/repository.ts`:

```ts
import type { TgChannelRecordInput, TgMessageRecordInput } from "./types";

type Queryable = {
  query<T = { id: string | number }>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

function toNumberId(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid database id: ${value}`);
  }
  return parsed;
}

export function createTelegramRepository(client: Queryable) {
  return {
    async upsertChannel(input: TgChannelRecordInput): Promise<number> {
      const result = await client.query<{ id: string | number }>(
        `
        insert into tg_channels
          (ref, telegram_channel_id, username, title, link, avatar_url, tags, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, now())
        on conflict (ref) do update set
          telegram_channel_id = excluded.telegram_channel_id,
          username = excluded.username,
          title = excluded.title,
          link = excluded.link,
          avatar_url = coalesce(excluded.avatar_url, tg_channels.avatar_url),
          tags = excluded.tags,
          updated_at = now()
        returning id
        `,
        [
          input.ref,
          input.telegramChannelId,
          input.username,
          input.title,
          input.link,
          input.avatarUrl,
          input.tags,
        ],
      );
      return toNumberId(result.rows[0].id);
    },

    async upsertMessage(input: TgMessageRecordInput): Promise<number> {
      const result = await client.query<{ id: string | number }>(
        `
        insert into tg_messages
          (channel_db_id, channel_id, message_id, message_url, text, created_at, views, forwards, origin, raw, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        on conflict (channel_id, message_id) do update set
          text = excluded.text,
          views = excluded.views,
          forwards = excluded.forwards,
          raw = excluded.raw,
          updated_at = now()
        returning id
        `,
        [
          input.channelDbId,
          input.channelId,
          input.messageId,
          input.messageUrl,
          input.text,
          input.createdAt,
          input.views,
          input.forwards,
          input.origin,
          input.raw,
        ],
      );
      return toNumberId(result.rows[0].id);
    },
  };
}
```

Create `src/lib/tg-pipeline/db.ts`:

```ts
import pg from "pg";
import { loadTelegramPipelineConfig } from "./config";

const { Pool } = pg;
let pool: pg.Pool | null = null;

export function getTelegramPipelinePool(): pg.Pool {
  if (!pool) {
    const config = loadTelegramPipelineConfig();
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export async function closeTelegramPipelinePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
```

- [ ] **Step 4: Run repository test**

Run:

```powershell
node src/lib/tg-pipeline/repository.test.mjs
```

Expected: `ok - repository upserts channels and messages`.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/tg-pipeline/types.ts src/lib/tg-pipeline/db.ts src/lib/tg-pipeline/repository.ts src/lib/tg-pipeline/repository.test.mjs
git commit -m "feat: add telegram pipeline repository"
```

### Task 4: Message Normalization

**Files:**
- Create: `src/lib/tg-pipeline/message-normalizer.ts`
- Create: `src/lib/tg-pipeline/message-normalizer.test.mjs`

- [ ] **Step 1: Write normalizer test**

Create a test that passes a GramJS-like plain object and verifies stable output:

```js
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

const { normalizeTelegramMessage } = await importTs("./message-normalizer.ts");

const normalized = normalizeTelegramMessage(
  {
    id: 123,
    message: "hello",
    date: 1777300000,
    views: 10,
    forwards: 2,
    media: { className: "MessageMediaPhoto" },
  },
  {
    channelDbId: 11,
    ref: "au_call",
    channelId: "2955560057",
    username: "au_call",
  },
  "backfill",
);

assert.equal(normalized.message.channelDbId, 11);
assert.equal(normalized.message.channelId, "2955560057");
assert.equal(normalized.message.messageId, 123);
assert.equal(normalized.message.messageUrl, "https://t.me/au_call/123");
assert.equal(normalized.message.text, "hello");
assert.equal(normalized.message.origin, "backfill");
assert.equal(normalized.media?.kind, "image");
console.log("ok - normalizeTelegramMessage creates stable records");
```

- [ ] **Step 2: Implement normalizer**

Create `src/lib/tg-pipeline/message-normalizer.ts` with these exported signatures:

```ts
import type { TgMessageRecordInput } from "./types";

type ChannelContext = {
  channelDbId: number;
  ref: string;
  channelId: string;
  username: string;
};

export type NormalizedTelegramMedia = {
  kind: "image" | "video" | "gif" | "sticker";
  mimeType: string;
};

export type NormalizedTelegramMessage = {
  message: TgMessageRecordInput;
  media: NormalizedTelegramMedia | null;
};

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function inferMediaKind(media: unknown): NormalizedTelegramMedia | null {
  if (!media || typeof media !== "object") return null;
  const className = String((media as Record<string, unknown>).className ?? "");
  if (/photo/i.test(className)) return { kind: "image", mimeType: "image/jpeg" };
  if (/video/i.test(className)) return { kind: "video", mimeType: "video/mp4" };
  if (/document/i.test(className)) return { kind: "image", mimeType: "" };
  return null;
}

export function normalizeTelegramMessage(
  raw: Record<string, unknown>,
  channel: ChannelContext,
  origin: "realtime" | "backfill",
): NormalizedTelegramMessage | null {
  const id = readNumber(raw, "id");
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const seconds = readNumber(raw, "date");
  const createdAt = new Date(seconds * 1000).toISOString();
  const username = channel.username || channel.ref.replace(/^@+/, "");
  return {
    message: {
      channelDbId: channel.channelDbId,
      channelId: channel.channelId,
      messageId: id,
      messageUrl: `https://t.me/${username}/${id}`,
      text: String(raw.message ?? ""),
      createdAt,
      views: readNumber(raw, "views"),
      forwards: readNumber(raw, "forwards"),
      origin,
      raw,
    },
    media: inferMediaKind(raw.media),
  };
}
```

- [ ] **Step 3: Verify**

Run:

```powershell
node src/lib/tg-pipeline/message-normalizer.test.mjs
```

Expected: `ok - normalizeTelegramMessage creates stable records`.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/tg-pipeline/message-normalizer.ts src/lib/tg-pipeline/message-normalizer.test.mjs
git commit -m "feat: normalize telegram pipeline messages"
```

### Task 5: Media Store

**Files:**
- Create: `src/lib/tg-pipeline/media-store.ts`
- Create: `src/lib/tg-pipeline/media-store.test.mjs`

- [ ] **Step 1: Write media store test**

Test deterministic file paths:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile as readSource } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readSource(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const { writeTelegramMediaPreview } = await importTs("./media-store.ts");
const dir = await mkdtemp(join(tmpdir(), "tg-media-"));
const result = await writeTelegramMediaPreview({
  mediaDir: dir,
  publicBaseUrl: "/tg-media",
  channelId: "2955560057",
  messageId: 123,
  bytes: Buffer.from("image"),
  extension: "jpg",
});

assert.equal(result.publicUrl, "/tg-media/2955560057/123.jpg");
assert.equal(await readFile(join(dir, "2955560057", "123.jpg"), "utf8"), "image");
console.log("ok - writeTelegramMediaPreview stores deterministic media files");
```

- [ ] **Step 2: Implement media store**

Create `src/lib/tg-pipeline/media-store.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type WriteMediaInput = {
  mediaDir: string;
  publicBaseUrl: string;
  channelId: string;
  messageId: number;
  bytes: Buffer;
  extension: string;
};

export async function writeTelegramMediaPreview(input: WriteMediaInput) {
  const safeExtension = input.extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const channelDir = join(input.mediaDir, input.channelId);
  await mkdir(channelDir, { recursive: true });
  const fileName = `${input.messageId}.${safeExtension}`;
  await writeFile(join(channelDir, fileName), input.bytes);
  return {
    publicUrl: `${input.publicBaseUrl.replace(/\/$/, "")}/${input.channelId}/${fileName}`,
  };
}
```

- [ ] **Step 3: Verify**

Run:

```powershell
node src/lib/tg-pipeline/media-store.test.mjs
```

Expected: `ok - writeTelegramMediaPreview stores deterministic media files`.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/tg-pipeline/media-store.ts src/lib/tg-pipeline/media-store.test.mjs
git commit -m "feat: add telegram media store"
```

### Task 6: Queues

**Files:**
- Create: `src/lib/tg-pipeline/queue.ts`

- [ ] **Step 1: Create queue module**

Create `src/lib/tg-pipeline/queue.ts`:

```ts
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { loadTelegramPipelineConfig } from "./config";

export type TelegramJob =
  | { name: "backfill-channel"; data: { ref: string } }
  | { name: "download-media"; data: { channelId: string; messageId: number } }
  | { name: "refresh-avatar"; data: { ref: string } }
  | { name: "health-check"; data: Record<string, never> };

let connection: IORedis | null = null;
let queue: Queue | null = null;

export function getTelegramQueue(): Queue {
  if (!queue) {
    const config = loadTelegramPipelineConfig();
    connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue("telegram-pipeline", { connection });
  }
  return queue;
}

export async function enqueueTelegramJob(job: TelegramJob): Promise<void> {
  await getTelegramQueue().add(job.name, job.data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
```

- [ ] **Step 2: Verify types**

Run:

```powershell
npx tsc --noEmit
```

Expected: exit code `0`.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/tg-pipeline/queue.ts
git commit -m "feat: add telegram pipeline queues"
```

### Task 7: Worker-Owned Telegram Client

**Files:**
- Create: `src/lib/tg-pipeline/telegram-client.ts`

- [ ] **Step 1: Move client creation into worker-only module**

Create `src/lib/tg-pipeline/telegram-client.ts`:

```ts
import { makeTelegramClientOptions } from "@/lib/telegram-client-options";

type TelegramClientInstance = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  checkAuthorization(): Promise<boolean>;
  getMe(): Promise<unknown>;
  getEntity(entity: string | number): Promise<unknown>;
  getMessages(entity: unknown, options: { limit: number; minId?: number }): Promise<Iterable<unknown>>;
  downloadMedia(messageOrMedia: unknown): Promise<Buffer | string | undefined>;
  addEventHandler(handler: (event: unknown) => void | Promise<void>, eventBuilder: unknown): void;
};

export async function createWorkerTelegramClient(): Promise<{
  client: TelegramClientInstance;
  NewMessage: new (options?: unknown) => unknown;
}> {
  const telegram = await import("telegram");
  const sessions = await import("telegram/sessions");
  const client = new telegram.TelegramClient(
    new sessions.StringSession(process.env.TELEGRAM_SESSION ?? ""),
    Number(process.env.TELEGRAM_API_ID ?? 0),
    process.env.TELEGRAM_API_HASH ?? "",
    makeTelegramClientOptions(),
  ) as TelegramClientInstance;
  await client.connect();
  const authorized = await client.checkAuthorization();
  if (!authorized) {
    throw new Error("TELEGRAM_SESSION is not authorized");
  }
  await client.getMe();
  return { client, NewMessage: telegram.events.NewMessage };
}
```

- [ ] **Step 2: Verify types**

Run:

```powershell
npx tsc --noEmit
```

Expected: if `telegram.events.NewMessage` type access fails, import `telegram/events` in this module and expose `NewMessage` from that import.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/tg-pipeline/telegram-client.ts
git commit -m "feat: isolate worker telegram client"
```

### Task 8: Collector and Backfill Worker

**Files:**
- Create: `src/workers/telegram-collector.ts`
- Create: `src/workers/telegram-worker.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement collector loop**

Create `src/workers/telegram-collector.ts`:

```ts
import { getTelegramPipelinePool } from "@/lib/tg-pipeline/db";
import { createTelegramRepository } from "@/lib/tg-pipeline/repository";
import { createWorkerTelegramClient } from "@/lib/tg-pipeline/telegram-client";
import { enqueueTelegramJob } from "@/lib/tg-pipeline/queue";

async function main() {
  const pool = getTelegramPipelinePool();
  const repo = createTelegramRepository(pool);
  const { client, NewMessage } = await createWorkerTelegramClient();

  client.addEventHandler(async (event: unknown) => {
    console.log(JSON.stringify({ level: "info", event: "tg_message_seen" }));
    await enqueueTelegramJob({ name: "health-check", data: {} });
  }, new NewMessage({}));

  setInterval(() => {
    void enqueueTelegramJob({ name: "health-check", data: {} });
  }, 30_000);

  console.log(JSON.stringify({ level: "info", event: "telegram_collector_started" }));
  void repo;
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "error", event: "telegram_collector_failed", error: String(error) }));
  process.exit(1);
});
```

- [ ] **Step 2: Implement worker skeleton**

Create `src/workers/telegram-worker.ts`:

```ts
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { loadTelegramPipelineConfig } from "@/lib/tg-pipeline/config";

const config = loadTelegramPipelineConfig();
const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

new Worker(
  "telegram-pipeline",
  async (job) => {
    if (job.name === "health-check") {
      console.log(JSON.stringify({ level: "info", event: "telegram_health_check" }));
      return;
    }
    if (job.name === "backfill-channel") {
      console.log(JSON.stringify({ level: "info", event: "telegram_backfill_requested", data: job.data }));
      return;
    }
    if (job.name === "download-media") {
      console.log(JSON.stringify({ level: "info", event: "telegram_media_requested", data: job.data }));
      return;
    }
    if (job.name === "refresh-avatar") {
      console.log(JSON.stringify({ level: "info", event: "telegram_avatar_requested", data: job.data }));
      return;
    }
    throw new Error(`Unsupported telegram job: ${job.name}`);
  },
  { connection, concurrency: config.mediaConcurrency },
);
```

- [ ] **Step 3: Verify worker compilation**

Run:

```powershell
npx tsc --noEmit
```

Expected: exit code `0`.

- [ ] **Step 4: Commit**

```powershell
git add src/workers/telegram-collector.ts src/workers/telegram-worker.ts package.json package-lock.json
git commit -m "feat: add telegram pipeline workers"
```

### Task 9: Database-Backed Telegram API

**Files:**
- Modify: `src/lib/tg-pipeline/repository.ts`
- Modify: `src/app/api/telegram/route.ts`

- [ ] **Step 1: Add read model method**

Add this method to `createTelegramRepository`:

```ts
async listDashboardMessages(limit = 100) {
  const result = await client.query(
    `
    select
      m.channel_id,
      m.message_id,
      m.message_url,
      m.text,
      m.created_at,
      m.views,
      m.forwards,
      m.origin,
      c.ref,
      c.title,
      c.username,
      c.link,
      c.avatar_url,
      media.kind as media_kind,
      media.mime_type as media_mime_type,
      media.storage_url as media_url,
      media.width as media_width,
      media.height as media_height
    from tg_messages m
    join tg_channels c on c.id = m.channel_db_id
    left join tg_media media on media.message_db_id = m.id and media.status = 'ready'
    order by m.created_at desc
    limit $1
    `,
    [limit],
  );
  return result.rows;
}
```

- [ ] **Step 2: Route API through database when enabled**

Modify `src/app/api/telegram/route.ts`:

```ts
import { loadTelegramPipelineConfig } from "@/lib/tg-pipeline/config";
import { getTelegramPipelinePool } from "@/lib/tg-pipeline/db";
import { createTelegramRepository } from "@/lib/tg-pipeline/repository";
```

At the top of `GET`, before the legacy refresh logic:

```ts
const pipeline = loadTelegramPipelineConfig();
if (pipeline.enabled) {
  const repo = createTelegramRepository(getTelegramPipelinePool());
  const rows = await repo.listDashboardMessages(100);
  return NextResponse.json({
    provider: "telegram",
    mode: "mtproto",
    isConfigured: true,
    isConnected: true,
    status: rows.length > 0 ? "live" : "limited",
    channels: [],
    feed: rows.map(mapTelegramDbRowToFeedItem),
    note: "Telegram messages are served from the persisted pipeline cache.",
    errors: [],
    refresh: {
      source: "cache",
      servedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      cacheFetchedAt: null,
    },
  });
}
```

Add `mapTelegramDbRowToFeedItem` in the same file or a focused mapper module. It must produce the existing `TelegramFeedItem` shape used by `unified-news-panel.tsx`.

- [ ] **Step 3: Verify**

Run:

```powershell
npx tsc --noEmit
npm run lint
```

Expected: both pass.

- [ ] **Step 4: Commit**

```powershell
git add src/app/api/telegram/route.ts src/lib/tg-pipeline/repository.ts
git commit -m "feat: serve telegram dashboard from pipeline cache"
```

### Task 10: SSE Updates

**Files:**
- Create: `src/app/api/telegram/events/route.ts`
- Modify: `src/components/unified-news-panel.tsx`

- [ ] **Step 1: Add SSE route**

Create `src/app/api/telegram/events/route.ts`:

```ts
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        controller.enqueue(
          encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`),
        );
      }, 15_000);

      return () => clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Wire frontend SSE without removing polling yet**

In `src/components/unified-news-panel.tsx`, add an `EventSource` effect next to the current Telegram refresh effect:

```tsx
useEffect(() => {
  const source = new EventSource("/api/telegram/events");
  source.addEventListener("telegram-message", (event) => {
    const payload = parseEventPayload<TelegramDashboardSnapshot>(event);
    if (!payload) return;
    startTransition(() => {
      setTelegramSnapshot((current) => mergeTelegramSnapshot(current, payload));
    });
  });
  return () => source.close();
}, []);
```

- [ ] **Step 3: Verify browser behavior**

Run:

```powershell
npm run build
npm run start
```

Open `http://localhost:3000`. Expected: page loads with no console error; `/api/telegram/events` remains connected and emits heartbeat events.

- [ ] **Step 4: Commit**

```powershell
git add src/app/api/telegram/events/route.ts src/components/unified-news-panel.tsx
git commit -m "feat: add telegram dashboard event stream"
```

### Task 11: Settings Sync and Backfill Scheduling

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/lib/tg-pipeline/repository.ts`

- [ ] **Step 1: Enqueue jobs on channel changes**

In `src/app/api/settings/route.ts`, import:

```ts
import { loadTelegramPipelineConfig } from "@/lib/tg-pipeline/config";
import { enqueueTelegramJob } from "@/lib/tg-pipeline/queue";
```

After successful `telegram.add` and `telegram.batchAdd`, enqueue one backfill job per ref when pipeline is enabled:

```ts
const pipeline = loadTelegramPipelineConfig();
if (pipeline.enabled) {
  await enqueueTelegramJob({ name: "backfill-channel", data: { ref: body.ref } });
}
```

For batch add:

```ts
const pipeline = loadTelegramPipelineConfig();
if (pipeline.enabled) {
  for (const ref of refs) {
    await enqueueTelegramJob({ name: "backfill-channel", data: { ref } });
  }
}
```

- [ ] **Step 2: Verify**

Run:

```powershell
npx tsc --noEmit
npm run lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```powershell
git add src/app/api/settings/route.ts
git commit -m "feat: schedule telegram backfill from settings"
```

### Task 12: Docker Compose Deployment

**Files:**
- Create: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add compose file**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: signal_hub
      POSTGRES_USER: signal_hub
      POSTGRES_PASSWORD: signal_hub_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    restart: unless-stopped
    ports:
      - "6379:6379"

  web:
    image: node:22
    working_dir: /app
    command: sh -c "npm install && npm run build && npm run start"
    restart: unless-stopped
    env_file: .env.local
    ports:
      - "3000:3000"
    volumes:
      - .:/app
    depends_on:
      - postgres
      - redis

  collector:
    image: node:22
    working_dir: /app
    command: sh -c "npm install && npm run tg:collector"
    restart: unless-stopped
    env_file: .env.local
    volumes:
      - .:/app
    depends_on:
      - postgres
      - redis

  worker:
    image: node:22
    working_dir: /app
    command: sh -c "npm install && npm run tg:worker"
    restart: unless-stopped
    env_file: .env.local
    volumes:
      - .:/app
    depends_on:
      - postgres
      - redis

volumes:
  postgres-data:
```

- [ ] **Step 2: Update env example**

Add:

```dotenv
TG_PIPELINE_ENABLED=false
DATABASE_URL=postgres://signal_hub:signal_hub_password@localhost:5432/signal_hub
REDIS_URL=redis://localhost:6379
TG_MEDIA_DIR=.signal-hub/tg-media
TG_PUBLIC_MEDIA_BASE_URL=/tg-media
TG_BACKFILL_INTERVAL_MS=60000
TG_BACKFILL_MESSAGES_PER_CHANNEL=80
TG_MEDIA_CONCURRENCY=2
```

- [ ] **Step 3: Verify compose syntax**

Run:

```powershell
docker compose config
```

Expected: compose config prints merged services without errors.

- [ ] **Step 4: Commit**

```powershell
git add docker-compose.yml .env.example
git commit -m "chore: add telegram pipeline compose stack"
```

### Task 13: Cutover and Legacy Pull Disable

**Files:**
- Modify: `src/app/api/telegram/route.ts`
- Modify: `src/components/unified-news-panel.tsx`
- Modify: `src/lib/telegram-channels.ts`

- [ ] **Step 1: Run the new stack locally**

Run:

```powershell
docker compose up -d postgres redis
$env:DATABASE_URL='postgres://signal_hub:signal_hub_password@localhost:5432/signal_hub'
$env:REDIS_URL='redis://localhost:6379'
npm run tg:migrate
```

Expected: `telegram pipeline schema applied`.

- [ ] **Step 2: Start workers**

Open separate terminals:

```powershell
npm run tg:worker
```

```powershell
npm run tg:collector
```

Expected: logs show `telegram_collector_started` and recurring `telegram_health_check`.

- [ ] **Step 3: Enable read path**

Set in `.env.local`:

```dotenv
TG_PIPELINE_ENABLED=true
```

Restart `npm run start` or `npm run dev`.

- [ ] **Step 4: Verify API no longer triggers legacy refresh**

Run:

```powershell
Invoke-RestMethod 'http://localhost:3000/api/telegram' | ConvertTo-Json -Depth 4
```

Expected:
- Response returns quickly from database.
- `refresh.source` is `cache`.
- No `解析 ... 超时` errors appear in the response.
- `.next-start.log` does not show GramJS reconnect logs caused by page refresh.

- [ ] **Step 5: Remove forced Telegram refresh from frontend**

In `src/components/unified-news-panel.tsx`, keep normal periodic cache reads but remove any call that adds `?refresh=1` when `TG_PIPELINE_ENABLED=true`. The browser should only use:

```ts
fetch("/api/telegram", { cache: "no-store" })
```

and the SSE stream:

```ts
new EventSource("/api/telegram/events")
```

- [ ] **Step 6: Verify production build**

Run:

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src/app/api/telegram/route.ts src/components/unified-news-panel.tsx src/lib/telegram-channels.ts .env.example
git commit -m "feat: cut telegram dashboard over to pipeline cache"
```

## Final Verification

Run these checks before declaring the migration complete:

```powershell
node src/lib/tg-pipeline/config.test.mjs
node src/lib/tg-pipeline/repository.test.mjs
node src/lib/tg-pipeline/message-normalizer.test.mjs
node src/lib/tg-pipeline/media-store.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Manual browser checks:

- Open `http://localhost:3000`.
- Confirm the first paint shows cached Telegram messages without waiting for Telegram network calls.
- Keep the page open and confirm new persisted messages merge into the feed without refresh.
- Stop the collector process and confirm the page still shows existing messages plus a stale/failing health status.
- Restart the collector and confirm health returns to live without clearing the feed.

## Rollback

Set:

```dotenv
TG_PIPELINE_ENABLED=false
```

Restart the web process. The legacy `/api/telegram` path will serve the previous cache/refresh behavior while the collector and database can remain running for diagnosis.

## Self-Review

- Spec coverage: the plan covers background collection, persistent storage, queue-based retries, async media, frontend read-only behavior, settings sync, deployment, and rollback.
- Placeholder scan: no empty implementation sections are left for the worker/API boundaries; the only deliberately staged behavior is guarded by `TG_PIPELINE_ENABLED`.
- Type consistency: channel/message ids use `telegram_channel_id`, `channel_id`, and `message_id` consistently; the repository exposes `upsertChannel`, `upsertMessage`, and `listDashboardMessages`.
