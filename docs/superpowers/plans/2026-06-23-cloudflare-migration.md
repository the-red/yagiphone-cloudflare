# yagiphone Cloudflare版 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AWS版 yagiphone（マルチテナント型 Twilio IVR SaaS）を、単一のCloudflare Worker（Hono + D1 + Static Assets + Access）として再構築する。

**Architecture:** 1つのWorkerがHonoで全リクエストを処理する。Twilio Webhook（無認可・署名検証あり）はTwiMLを返し、`/admin/*`（Cloudflare Access保護）はJSONを返す。データはD1（SQLite）。APIに該当しないパスはStatic Assets（Next.js静的export）へフォールバックする。

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1 (SQLite), Cloudflare Access, Vitest + @cloudflare/vitest-pool-workers, Wrangler, Next.js 15（静的export）。

## Global Constraints

- 言語/モジュール: TypeScript, ESM（`"type": "module"`）。
- ランタイム: Cloudflare Workers（V8 isolate）。Node.js専用API・ネイティブ依存は使わない。`nodejs_compat` は使わない方針。
- ルーター: Hono。
- 文字列・XMLは手組み（外部XMLライブラリ不使用）。XMLチャーデータは `& < > " '` をエスケープする。
- TwiML: 言語 `ja-JP`、音声 `Polly.Mizuki`。XML宣言は `<?xml version="1.0" encoding="UTF-8"?>`。
- DBバインディング名は `DB`、静的アセットバインディング名は `ASSETS`。
- テストは各タスクで必ず先に失敗させてから実装する（TDD）。
- コミットは各タスク完了ごと。コミットメッセージ末尾に必ず付与:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 移植元（参照のみ・変更しない）: `/Users/the_red/ghq/github.com/the-red/yagiphone`

---

## Task 1: プロジェクト足場（Worker + Hono + Vitest + /health）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `vitest.config.ts`
- Create: `src/env.ts`
- Create: `src/index.ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Produces: `Env`（`src/env.ts`）= `{ DB: D1Database; ASSETS: Fetcher; ACCESS_ENABLED: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; TWILIO_VALIDATE: string }`
- Produces: `app`（`src/index.ts`、`Hono<{ Bindings: Env }>` の default export `{ fetch }`）
- Produces: ルート `GET /health` → `{"status":"ok"}`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "yagiphone-cloudflare",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "migrate:local": "wrangler d1 migrations apply yagiphone --local",
    "migrate:remote": "wrangler d1 migrations apply yagiphone --remote"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240000.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.80.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: wrangler.jsonc を作成**

`database_id` は Task 2 で `wrangler d1 create` 後に実IDへ差し替える。初期は空文字でよい（ローカルテストはmigrations/バインディング名で動く）。

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "yagiphone",
  "main": "src/index.ts",
  "compatibility_date": "2024-11-01",
  "assets": {
    "directory": "./web/out",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "yagiphone",
      "database_id": "",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "ACCESS_ENABLED": "false",
    "ACCESS_TEAM_DOMAIN": "",
    "ACCESS_AUD": "",
    "TWILIO_VALIDATE": "false"
  }
}
```

- [ ] **Step 4: vitest.config.ts を作成**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // テスト用D1。マイグレーションは各テストの setup で適用する。
          d1Databases: ['DB'],
        },
      },
    },
  },
});
```

- [ ] **Step 5: src/env.ts を作成**

```ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_ENABLED: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  TWILIO_VALIDATE: string;
}
```

- [ ] **Step 6: 失敗するテストを書く（test/health.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 7: テストを実行して失敗を確認**

Run: `npm install && npm test`
Expected: FAIL（`src/index` が存在しない / モジュール解決エラー）

- [ ] **Step 8: src/index.ts を実装**

```ts
import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

// APIに該当しないパスは静的アセットへフォールバック
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
```

- [ ] **Step 9: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: コミット**

```bash
git add -A
git commit -m "feat: Worker足場(Hono + Vitest)と/healthを追加"
```

---

## Task 2: D1スキーマとマイグレーション

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `test/helpers/db.ts`
- Modify: `vitest.config.ts`
- Test: `test/schema.test.ts`

**Interfaces:**
- Produces: テーブル `tenants`, `contacts`（DDLはスペック準拠）
- Produces: `applyMigrations(): Promise<void>`（テストでスキーマを適用するヘルパ）
- Produces: `seedTenant(partial?)` / `seedContact(partial?)`（テスト用シード）

- [ ] **Step 1: migrations/0001_init.sql を作成**

```sql
-- tenants: 自治会（テナント）設定。Twilio認証情報を保持。
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  twilio_account_sid TEXT NOT NULL,
  twilio_auth_token  TEXT NOT NULL,
  twilio_caller_id   TEXT NOT NULL,
  max_recording_length INTEGER NOT NULL DEFAULT 0,
  domain TEXT
);
CREATE INDEX idx_tenants_caller_id ON tenants(twilio_caller_id);

-- contacts: 名簿。contact_key = "recorder#<番号>" / "listener#<番号>"
CREATE TABLE contacts (
  tenant_id    TEXT NOT NULL,
  contact_key  TEXT NOT NULL,
  name         TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  contact_type TEXT NOT NULL,
  PRIMARY KEY (tenant_id, contact_key)
);
CREATE INDEX idx_contacts_tenant_type ON contacts(tenant_id, contact_type);
```

- [ ] **Step 2: vitest.config.ts にマイグレーション読み込みを追加**

公式パターン（`readD1Migrations`）で `migrations/` を読み、テスト用バインディング `TEST_MIGRATIONS` として渡す。

```ts
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            d1Databases: ['DB'],
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
```

- [ ] **Step 3: test/helpers/db.ts を作成**

```ts
import { env, applyD1Migrations } from 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}

export async function applyMigrations(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

export async function seedTenant(partial: Partial<Record<string, string | number>> = {}) {
  const t = {
    tenant_id: 'hosoiri',
    name: '細入',
    twilio_account_sid: 'ACxxxx',
    twilio_auth_token: 'token-hosoiri',
    twilio_caller_id: '+815000000001',
    max_recording_length: 0,
    domain: 'example.test',
    ...partial,
  };
  await env.DB.prepare(
    `INSERT INTO tenants (tenant_id,name,twilio_account_sid,twilio_auth_token,twilio_caller_id,max_recording_length,domain)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(t.tenant_id, t.name, t.twilio_account_sid, t.twilio_auth_token, t.twilio_caller_id, t.max_recording_length, t.domain).run();
  return t;
}

export async function seedContact(partial: Partial<Record<string, string>> = {}) {
  const phone = partial.phone_number ?? '+819000000001';
  const type = partial.contact_type ?? 'recorder';
  const c = {
    tenant_id: 'hosoiri',
    contact_key: `${type}#${phone}`,
    name: '山田太郎',
    phone_number: phone,
    contact_type: type,
    ...partial,
  };
  await env.DB.prepare(
    `INSERT INTO contacts (tenant_id,contact_key,name,phone_number,contact_type) VALUES (?,?,?,?,?)`,
  ).bind(c.tenant_id, c.contact_key, c.name, c.phone_number, c.contact_type).run();
  return c;
}
```

注: `applyD1Migrations` / `readD1Migrations` のシグネチャは導入する `@cloudflare/vitest-pool-workers` のバージョンで要確認。導入時に `node_modules/@cloudflare/vitest-pool-workers` のREADMEで最新APIを確認すること（公式の「Test APIs」「D1」セクション準拠）。

- [ ] **Step 4: 失敗するテストを書く（test/schema.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, seedTenant } from './helpers/db';

describe('schema', () => {
  beforeAll(async () => { await applyMigrations(); });

  it('tenants へ挿入・取得できる', async () => {
    await seedTenant({ tenant_id: 't1', twilio_caller_id: '+810' });
    const row = await env.DB.prepare('SELECT tenant_id FROM tenants WHERE twilio_caller_id=?')
      .bind('+810').first<{ tenant_id: string }>();
    expect(row?.tenant_id).toBe('t1');
  });
});
```

- [ ] **Step 5: テストを実行して失敗を確認**

Run: `npm test -- schema`
Expected: FAIL（テーブル未作成 or ヘルパ未整備）

- [ ] **Step 6: 上記 Step 1-3 の内容で通るよう調整し成功を確認**

Run: `npm test -- schema`
Expected: PASS

- [ ] **Step 7: ローカルD1作成とマイグレーション適用（手動・任意）**

```bash
npx wrangler d1 create yagiphone   # 出力された database_id を wrangler.jsonc に記入
npm run migrate:local
```

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: D1スキーマ(tenants/contacts)とマイグレーション・テスト基盤を追加"
```

---

## Task 3: ドメイン型とテナントクエリ層

**Files:**
- Create: `src/db/types.ts`
- Create: `src/db/tenants.ts`
- Test: `test/db/tenants.test.ts`

**Interfaces:**
- Produces（`src/db/types.ts`）:
  - `interface Tenant { tenantId: string; name: string; twilioAccountSid: string; twilioAuthToken: string; twilioCallerId: string; maxRecordingLength: number; domain: string | null }`
  - `interface Contact { tenantId: string; contactKey: string; name: string; phoneNumber: string; contactType: 'recorder' | 'listener' }`
  - `toTenant(row): Tenant` / `toContact(row): Contact`
- Produces（`src/db/tenants.ts`）:
  - `getTenant(db: D1Database, tenantId: string): Promise<Tenant | null>`
  - `getTenantByCallerId(db: D1Database, callerId: string): Promise<Tenant | null>`

- [ ] **Step 1: src/db/types.ts を作成**

```ts
export interface Tenant {
  tenantId: string;
  name: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioCallerId: string;
  maxRecordingLength: number;
  domain: string | null;
}

export interface Contact {
  tenantId: string;
  contactKey: string;
  name: string;
  phoneNumber: string;
  contactType: 'recorder' | 'listener';
}

interface TenantRow {
  tenant_id: string; name: string; twilio_account_sid: string; twilio_auth_token: string;
  twilio_caller_id: string; max_recording_length: number; domain: string | null;
}

export function toTenant(r: TenantRow): Tenant {
  return {
    tenantId: r.tenant_id, name: r.name, twilioAccountSid: r.twilio_account_sid,
    twilioAuthToken: r.twilio_auth_token, twilioCallerId: r.twilio_caller_id,
    maxRecordingLength: r.max_recording_length, domain: r.domain,
  };
}

interface ContactRow {
  tenant_id: string; contact_key: string; name: string; phone_number: string; contact_type: string;
}

export function toContact(r: ContactRow): Contact {
  return {
    tenantId: r.tenant_id, contactKey: r.contact_key, name: r.name,
    phoneNumber: r.phone_number, contactType: r.contact_type as 'recorder' | 'listener',
  };
}
```

- [ ] **Step 2: 失敗するテストを書く（test/db/tenants.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, seedTenant } from '../helpers/db';
import { getTenant, getTenantByCallerId } from '../../src/db/tenants';

describe('tenants queries', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedTenant({ tenant_id: 'hosoiri', twilio_caller_id: '+815000000001', name: '細入' });
  });

  it('getTenant: IDで取得しcamelCaseで返す', async () => {
    const t = await getTenant(env.DB, 'hosoiri');
    expect(t?.name).toBe('細入');
    expect(t?.twilioCallerId).toBe('+815000000001');
  });

  it('getTenant: 不在はnull', async () => {
    expect(await getTenant(env.DB, 'none')).toBeNull();
  });

  it('getTenantByCallerId: callerIdで取得', async () => {
    const t = await getTenantByCallerId(env.DB, '+815000000001');
    expect(t?.tenantId).toBe('hosoiri');
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `npm test -- tenants`
Expected: FAIL（`src/db/tenants` 未実装）

- [ ] **Step 4: src/db/tenants.ts を実装**

```ts
import type { Tenant } from './types';
import { toTenant } from './types';

export async function getTenant(db: D1Database, tenantId: string): Promise<Tenant | null> {
  const row = await db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').bind(tenantId).first();
  return row ? toTenant(row as any) : null;
}

export async function getTenantByCallerId(db: D1Database, callerId: string): Promise<Tenant | null> {
  const row = await db.prepare('SELECT * FROM tenants WHERE twilio_caller_id = ?').bind(callerId).first();
  return row ? toTenant(row as any) : null;
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npm test -- tenants`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: ドメイン型とテナントクエリ層を追加"
```

---

## Task 4: 名簿（contacts）クエリ層

**Files:**
- Create: `src/db/contacts.ts`
- Test: `test/db/contacts.test.ts`

**Interfaces:**
- Consumes: `Contact`, `toContact`（`src/db/types.ts`）
- Produces（`src/db/contacts.ts`）:
  - `findContact(db, tenantId, phoneNumber): Promise<Contact | null>`（recorder→listenerの順で探す）
  - `findRecorder(db, tenantId, phoneNumber): Promise<Contact | null>`
  - `listRecorders(db, tenantId): Promise<Contact[]>`
  - `listListeners(db, tenantId): Promise<Contact[]>`
  - `listAllContacts(db, tenantId): Promise<Contact[]>`
  - `createContact(db, c: Contact): Promise<void>`（upsert）
  - `deleteContact(db, tenantId, contactKey): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く（test/db/contacts.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrations } from '../helpers/db';
import {
  findContact, findRecorder, listRecorders, listListeners,
  listAllContacts, createContact, deleteContact,
} from '../../src/db/contacts';

describe('contacts queries', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
  });

  it('createContact + findRecorder', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+8190', name: '太郎', phoneNumber: '+8190', contactType: 'recorder' });
    const r = await findRecorder(env.DB, 't', '+8190');
    expect(r?.name).toBe('太郎');
    expect(await findRecorder(env.DB, 't', '+0000')).toBeNull();
  });

  it('findContact は recorder/listener 両方を探す', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'listener#+8191', name: '花子', phoneNumber: '+8191', contactType: 'listener' });
    const c = await findContact(env.DB, 't', '+8191');
    expect(c?.contactType).toBe('listener');
    expect(await findContact(env.DB, 't', '+9999')).toBeNull();
  });

  it('listRecorders / listListeners / listAllContacts', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+1', name: 'a', phoneNumber: '+1', contactType: 'recorder' });
    await createContact(env.DB, { tenantId: 't', contactKey: 'listener#+2', name: 'b', phoneNumber: '+2', contactType: 'listener' });
    expect((await listRecorders(env.DB, 't')).length).toBe(1);
    expect((await listListeners(env.DB, 't')).length).toBe(1);
    expect((await listAllContacts(env.DB, 't')).length).toBe(2);
  });

  it('createContact はupsert / deleteContact', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+1', name: 'old', phoneNumber: '+1', contactType: 'recorder' });
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+1', name: 'new', phoneNumber: '+1', contactType: 'recorder' });
    expect((await findRecorder(env.DB, 't', '+1'))?.name).toBe('new');
    await deleteContact(env.DB, 't', 'recorder#+1');
    expect(await findRecorder(env.DB, 't', '+1')).toBeNull();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- contacts`
Expected: FAIL（`src/db/contacts` 未実装）

- [ ] **Step 3: src/db/contacts.ts を実装**

```ts
import type { Contact } from './types';
import { toContact } from './types';

async function getByKey(db: D1Database, tenantId: string, contactKey: string): Promise<Contact | null> {
  const row = await db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND contact_key = ?')
    .bind(tenantId, contactKey).first();
  return row ? toContact(row as any) : null;
}

export function findRecorder(db: D1Database, tenantId: string, phoneNumber: string) {
  return getByKey(db, tenantId, `recorder#${phoneNumber}`);
}

export async function findContact(db: D1Database, tenantId: string, phoneNumber: string): Promise<Contact | null> {
  for (const type of ['recorder', 'listener']) {
    const c = await getByKey(db, tenantId, `${type}#${phoneNumber}`);
    if (c) return c;
  }
  return null;
}

async function listByType(db: D1Database, tenantId: string, type: string): Promise<Contact[]> {
  const { results } = await db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND contact_type = ?')
    .bind(tenantId, type).all();
  return (results as any[]).map(toContact);
}

export const listRecorders = (db: D1Database, tenantId: string) => listByType(db, tenantId, 'recorder');
export const listListeners = (db: D1Database, tenantId: string) => listByType(db, tenantId, 'listener');

export async function listAllContacts(db: D1Database, tenantId: string): Promise<Contact[]> {
  const { results } = await db.prepare('SELECT * FROM contacts WHERE tenant_id = ?').bind(tenantId).all();
  return (results as any[]).map(toContact);
}

export async function createContact(db: D1Database, c: Contact): Promise<void> {
  await db.prepare(
    `INSERT INTO contacts (tenant_id, contact_key, name, phone_number, contact_type)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, contact_key) DO UPDATE SET
       name = excluded.name, phone_number = excluded.phone_number, contact_type = excluded.contact_type`,
  ).bind(c.tenantId, c.contactKey, c.name, c.phoneNumber, c.contactType).run();
}

export async function deleteContact(db: D1Database, tenantId: string, contactKey: string): Promise<void> {
  await db.prepare('DELETE FROM contacts WHERE tenant_id = ? AND contact_key = ?')
    .bind(tenantId, contactKey).run();
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- contacts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: 名簿(contacts)クエリ層を追加"
```

---

## Task 5: TwiMLビルダ

**Files:**
- Create: `src/twiml/index.ts`
- Test: `test/twiml.test.ts`

**Interfaces:**
- Produces（`src/twiml/index.ts`）: `class TwiML`（メソッドは `this` を返すチェーン式）:
  - `say(text: string): this`
  - `gather(action: string, numDigits: number, build: (g: Gather) => void): this`（`Gather` は `say(text): this`）
  - `record(action: string, recordingStatusCallback: string, maxLength: number): this`
  - `play(url: string): this` / `pause(length: number): this` / `redirect(url: string): this` / `reject(): this` / `hangup(): this`
  - `toString(): string`
- Produces: `class Gather { say(text: string): this }`

XML仕様（移植元と一致）:
- `<Say language="ja-JP" voice="Polly.Mizuki">text</Say>`
- `<Gather action="..." numDigits="N">...</Gather>`
- `<Record action="..." recordingStatusCallback="..." recordingStatusCallbackMethod="GET" maxLength="N"></Record>`
- `<Play>url</Play>` / `<Pause length="N"></Pause>` / `<Redirect>url</Redirect>` / `<Reject></Reject>` / `<Hangup></Hangup>`
- チャーデータ/属性値は `& < > " '` をエスケープ。

- [ ] **Step 1: 失敗するテストを書く（test/twiml.test.ts）**

```ts
import { describe, it, expect } from 'vitest';
import { TwiML } from '../src/twiml';

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

describe('TwiML', () => {
  it('空レスポンス', () => {
    expect(new TwiML().toString()).toBe(`${HEADER}<Response></Response>`);
  });

  it('Say は言語と音声属性を持つ', () => {
    expect(new TwiML().say('こんにちは').toString())
      .toBe(`${HEADER}<Response><Say language="ja-JP" voice="Polly.Mizuki">こんにちは</Say></Response>`);
  });

  it('Gather は子のSayを含む', () => {
    const out = new TwiML().gather('/router', 1, (g) => g.say('1を押して')).toString();
    expect(out).toBe(`${HEADER}<Response><Gather action="/router" numDigits="1"><Say language="ja-JP" voice="Polly.Mizuki">1を押して</Say></Gather></Response>`);
  });

  it('Record', () => {
    const out = new TwiML().record('/hangup', '/dial?x=1', 50).toString();
    expect(out).toContain('<Record action="/hangup" recordingStatusCallback="/dial?x=1" recordingStatusCallbackMethod="GET" maxLength="50"></Record>');
  });

  it('Reject / Hangup / Redirect / Play / Pause', () => {
    expect(new TwiML().reject().toString()).toContain('<Reject></Reject>');
    expect(new TwiML().hangup().toString()).toContain('<Hangup></Hangup>');
    expect(new TwiML().redirect('/main').toString()).toContain('<Redirect>/main</Redirect>');
    expect(new TwiML().play('http://x/a.mp3').toString()).toContain('<Play>http://x/a.mp3</Play>');
    expect(new TwiML().pause(1).toString()).toContain('<Pause length="1"></Pause>');
  });

  it('特殊文字をエスケープ', () => {
    expect(new TwiML().say('a&b<c>').toString())
      .toContain('<Say language="ja-JP" voice="Polly.Mizuki">a&amp;b&lt;c&gt;</Say>');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- twiml`
Expected: FAIL（`src/twiml` 未実装）

- [ ] **Step 3: src/twiml/index.ts を実装**

```ts
const LANG = 'ja-JP';
const VOICE = 'Polly.Mizuki';
const HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sayXml(text: string): string {
  return `<Say language="${LANG}" voice="${VOICE}">${esc(text)}</Say>`;
}

export class Gather {
  constructor(private parts: string[]) {}
  say(text: string): this {
    this.parts.push(sayXml(text));
    return this;
  }
}

export class TwiML {
  private parts: string[] = [];

  say(text: string): this {
    this.parts.push(sayXml(text));
    return this;
  }

  gather(action: string, numDigits: number, build: (g: Gather) => void): this {
    const inner: string[] = [];
    build(new Gather(inner));
    this.parts.push(`<Gather action="${esc(action)}" numDigits="${numDigits}">${inner.join('')}</Gather>`);
    return this;
  }

  record(action: string, recordingStatusCallback: string, maxLength: number): this {
    this.parts.push(
      `<Record action="${esc(action)}" recordingStatusCallback="${esc(recordingStatusCallback)}" recordingStatusCallbackMethod="GET" maxLength="${maxLength}"></Record>`,
    );
    return this;
  }

  play(url: string): this { this.parts.push(`<Play>${esc(url)}</Play>`); return this; }
  pause(length: number): this { this.parts.push(`<Pause length="${length}"></Pause>`); return this; }
  redirect(url: string): this { this.parts.push(`<Redirect>${esc(url)}</Redirect>`); return this; }
  reject(): this { this.parts.push('<Reject></Reject>'); return this; }
  hangup(): this { this.parts.push('<Hangup></Hangup>'); return this; }

  toString(): string {
    return `${HEADER}<Response>${this.parts.join('')}</Response>`;
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- twiml`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: TwiMLビルダを追加"
```

---

## Task 6: Twilio RESTクライアント（fetchベース）

**Files:**
- Create: `src/twilio/client.ts`
- Test: `test/twilio.test.ts`

**Interfaces:**
- Produces（`src/twilio/client.ts`）:
  - `interface Recording { sid: string; callSid: string; duration: string; dateCreated: string; uri: string }`
  - `interface UsageRecord { category; startDate; endDate; count; countUnit; usage; usageUnit; price }`（全て string）
  - `class TwilioClient { constructor(accountSid: string, authToken: string, fetchImpl?: typeof fetch) }` with:
    - `makeCall(to, from, callUrl): Promise<void>`
    - `listRecordings(limit: number): Promise<Recording[]>`
    - `listUsageRecords(startDate, endDate): Promise<UsageRecord[]>`
    - `getCallFrom(callSid): Promise<string>`
  - `recordingUrl(uri: string): string`（`.json` を除去し `https://api.twilio.com` を前置）

- [ ] **Step 1: 失敗するテストを書く（test/twilio.test.ts）**

```ts
import { describe, it, expect, vi } from 'vitest';
import { TwilioClient, recordingUrl } from '../src/twilio/client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('TwilioClient', () => {
  it('makeCall は Calls.json にPOSTしBasic認証を付ける', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 201 }));
    const c = new TwilioClient('ACsid', 'tok', fetchMock as any);
    await c.makeCall('+81to', '+81from', 'https://x/play');
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACsid/Calls.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('ACsid:tok'));
    expect(init.body).toContain('To=%2B81to');
    expect(init.body).toContain('Method=GET');
  });

  it('makeCall は4xxで例外', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 400 }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    await expect(c.makeCall('a', 'b', 'c')).rejects.toThrow();
  });

  it('listRecordings はcamelCaseで返す', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ recordings: [{ sid: 'RE1', call_sid: 'CA1', duration: '5', date_created: 'd', uri: '/x.json' }] }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    const recs = await c.listRecordings(1);
    expect(recs[0]).toEqual({ sid: 'RE1', callSid: 'CA1', duration: '5', dateCreated: 'd', uri: '/x.json' });
  });

  it('getCallFrom は from を返す', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ from: '+8190' }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    expect(await c.getCallFrom('CA1')).toBe('+8190');
  });

  it('recordingUrl は.jsonを除去してフルURL化', () => {
    expect(recordingUrl('/2010-04-01/Accounts/AC/Recordings/RE1.json'))
      .toBe('https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- twilio`
Expected: FAIL（`src/twilio/client` 未実装）

- [ ] **Step 3: src/twilio/client.ts を実装**

```ts
const BASE_URL = 'https://api.twilio.com';

export interface Recording { sid: string; callSid: string; duration: string; dateCreated: string; uri: string; }
export interface UsageRecord {
  category: string; startDate: string; endDate: string; count: string;
  countUnit: string; usage: string; usageUnit: string; price: string;
}

export class TwilioClient {
  constructor(
    private accountSid: string,
    private authToken: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeader(): string {
    return 'Basic ' + btoa(`${this.accountSid}:${this.authToken}`);
  }

  async makeCall(to: string, from: string, callUrl: string): Promise<void> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
    const form = new URLSearchParams({ To: to, From: from, Url: callUrl, Method: 'GET' });
    const res = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (res.status >= 400) throw new Error(`Twilio API エラー: status=${res.status}`);
  }

  async listRecordings(limit: number): Promise<Recording[]> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Recordings.json?PageSize=${limit}`;
    const res = await this.fetchImpl(endpoint, { headers: { Authorization: this.authHeader() } });
    const data = await res.json() as { recordings?: any[] };
    return (data.recordings ?? []).map((r) => ({
      sid: r.sid, callSid: r.call_sid, duration: r.duration, dateCreated: r.date_created, uri: r.uri,
    }));
  }

  async listUsageRecords(startDate: string, endDate: string): Promise<UsageRecord[]> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Usage/Records.json?StartDate=${startDate}&EndDate=${endDate}`;
    const res = await this.fetchImpl(endpoint, { headers: { Authorization: this.authHeader() } });
    const data = await res.json() as { usage_records?: any[] };
    return (data.usage_records ?? []).map((u) => ({
      category: u.category, startDate: u.start_date, endDate: u.end_date, count: u.count,
      countUnit: u.count_unit, usage: u.usage, usageUnit: u.usage_unit, price: u.price,
    }));
  }

  async getCallFrom(callSid: string): Promise<string> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Calls/${callSid}.json`;
    const res = await this.fetchImpl(endpoint, { headers: { Authorization: this.authHeader() } });
    const data = await res.json() as { from?: string };
    return data.from ?? '';
  }
}

export function recordingUrl(uri: string): string {
  return BASE_URL + uri.replace(/\.json$/, '');
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- twilio`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: Twilio RESTクライアント(fetchベース)を追加"
```

---

## Task 7: Twilio署名検証

**Files:**
- Create: `src/twilio/signature.ts`
- Test: `test/signature.test.ts`

**Interfaces:**
- Produces（`src/twilio/signature.ts`）:
  - `computeSignature(authToken: string, url: string, params: Record<string,string>): Promise<string>`
    （URL + キー昇順の `key+value` 連結を HMAC-SHA1 → base64）
  - `verifyTwilioSignature(authToken, url, params, signature): Promise<boolean>`（タイミング安全比較）

- [ ] **Step 1: 失敗するテストを書く（test/signature.test.ts）**

Twilio公式ドキュメントの既知ベクトルを使用。

```ts
import { describe, it, expect } from 'vitest';
import { computeSignature, verifyTwilioSignature } from '../src/twilio/signature';

const TOKEN = '12345';
const URL = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const PARAMS = { Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE' };
const EXPECTED = '0/KCTR6DLpKmkAf8muzZqo1nDgQ=';

describe('twilio signature', () => {
  it('computeSignature が公式ベクトルと一致', async () => {
    expect(await computeSignature(TOKEN, URL, PARAMS)).toBe(EXPECTED);
  });

  it('verifyTwilioSignature: 正当な署名でtrue', async () => {
    expect(await verifyTwilioSignature(TOKEN, URL, PARAMS, EXPECTED)).toBe(true);
  });

  it('verifyTwilioSignature: 不正な署名でfalse', async () => {
    expect(await verifyTwilioSignature(TOKEN, URL, PARAMS, 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- signature`
Expected: FAIL（`src/twilio/signature` 未実装）

- [ ] **Step 3: src/twilio/signature.ts を実装**

```ts
// Twilio署名アルゴリズム: URL + (キー昇順の key+value 連結) を HMAC-SHA1 → base64
export async function computeSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): Promise<boolean> {
  const expected = await computeSignature(authToken, url, params);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- signature`
Expected: PASS。万一 EXPECTED 値が不一致なら、`console.log(await computeSignature(TOKEN, URL, PARAMS))` で実測し、Twilio公式ドキュメント「Validating Signatures from Twilio」の最新サンプルで検証ベクトルを確定すること（アルゴリズム自体は変更しない）。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: Twilio署名検証(HMAC-SHA1)を追加"
```

---

## Task 8: リクエスト共通ヘルパ（フォーム解析・テナント解決・署名ガード・TwiML応答）

**Files:**
- Create: `src/routes/helpers.ts`
- Test: `test/routes/helpers.test.ts`

**Interfaces:**
- Consumes: `getTenantByCallerId`（db/tenants）、`verifyTwilioSignature`（twilio/signature）、`TwiML`（twiml）、`Env`
- Produces（`src/routes/helpers.ts`）:
  - `type Ctx = Context<{ Bindings: Env }>`
  - `parseParams(c: Ctx): Promise<Record<string,string>>`（GETクエリ + POSTフォームをマージ）
  - `twimlResponse(c: Ctx, twiml: TwiML): Response`（`Content-Type: application/xml`）
  - `errorTwiml(c: Ctx): Response`（500、固定TwiML）
  - `resolveTenantByTo(c: Ctx, params): Promise<Tenant | null>`（`params.To` → getTenantByCallerId）
  - `assertTwilioSignature(c: Ctx, params, authToken): Promise<boolean>`（`TWILIO_VALIDATE!=='true'` なら常にtrue）

- [ ] **Step 1: 失敗するテストを書く（test/routes/helpers.test.ts）**

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { parseParams } from '../../src/routes/helpers';

describe('parseParams', () => {
  it('GETクエリを解析', async () => {
    const a = new Hono();
    a.get('/t', async (c) => c.json(await parseParams(c as any)));
    const res = await a.request('/t?To=%2B81&From=%2B90');
    expect(await res.json()).toEqual({ To: '+81', From: '+90' });
  });

  it('POSTフォームを解析', async () => {
    const a = new Hono();
    a.post('/t', async (c) => c.json(await parseParams(c as any)));
    const res = await a.request('/t', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'Digits=3&From=%2B90',
    });
    expect(await res.json()).toEqual({ Digits: '3', From: '+90' });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- helpers`
Expected: FAIL（`src/routes/helpers` 未実装）

- [ ] **Step 3: src/routes/helpers.ts を実装**

```ts
import type { Context } from 'hono';
import type { Env } from '../env';
import type { Tenant } from '../db/types';
import { getTenantByCallerId } from '../db/tenants';
import { verifyTwilioSignature } from '../twilio/signature';
import { TwiML } from '../twiml';

export type Ctx = Context<{ Bindings: Env }>;

// GETクエリ + POSTフォームをマージして文字列マップで返す
export async function parseParams(c: Ctx): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  const url = new URL(c.req.url);
  for (const [k, v] of url.searchParams) params[k] = v;
  const ct = c.req.header('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') params[k] = v;
  }
  return params;
}

export function twimlResponse(c: Ctx, twiml: TwiML): Response {
  return c.body(twiml.toString(), 200, { 'Content-Type': 'application/xml' });
}

export function errorTwiml(c: Ctx): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ja-JP" voice="Polly.Mizuki">エラーが発生しました</Say></Response>`;
  return c.body(xml, 500, { 'Content-Type': 'application/xml' });
}

export async function resolveTenantByTo(c: Ctx, params: Record<string, string>): Promise<Tenant | null> {
  const to = params.To;
  if (!to) return null;
  return getTenantByCallerId(c.env.DB, to);
}

// 署名検証。TWILIO_VALIDATE が 'true' のときのみ検証する。
export async function assertTwilioSignature(c: Ctx, params: Record<string, string>, authToken: string): Promise<boolean> {
  if (c.env.TWILIO_VALIDATE !== 'true') return true;
  const signature = c.req.header('X-Twilio-Signature') ?? '';
  // POSTはフォーム値を連結、GETはクエリ込み完全URLのみ（連結なし）。
  const isPost = (c.req.method === 'POST');
  const sigParams = isPost ? params : {};
  return verifyTwilioSignature(authToken, c.req.url, sigParams, signature);
}
```

注: GET webhookの署名検証はTwilioの仕様上クエリ込みURLで行う（フォーム連結なし）。POSTはフォーム値を連結。上記はその差異を `isPost` で吸収している。実際のTwilio Webhookメソッド設定（GET/POST）と各ルートのメソッドを整合させること。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- helpers`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: ルート共通ヘルパ(フォーム解析/テナント解決/署名ガード/TwiML応答)を追加"
```

---

## Task 9: Twilio Webhook ルート群（/main, /router, /record, /hangup）

**Files:**
- Create: `src/routes/twilio.ts`
- Modify: `src/index.ts`（twilioルートをマウント）
- Test: `test/routes/twilio-ivr.test.ts`

**Interfaces:**
- Consumes: helpers, db/tenants, db/contacts, twiml
- Produces（`src/routes/twilio.ts`）: `twilioRoutes: Hono<{ Bindings: Env }>` をエクスポート。登録するルート:
  - `GET/POST /main`, `POST /router`, `GET/POST /record`, `POST /hangup`
  （`/replay`, `/play`, `/dial` は Task 10 で同ファイルに追加）

- [ ] **Step 1: 失敗するテストを書く（test/routes/twilio-ivr.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { applyMigrations, seedTenant, seedContact } from '../helpers/db';

const TO = '+815000000001';
async function post(path: string, form: Record<string,string>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  }, env);
}

describe('Twilio IVR routes', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({ tenant_id: 'hosoiri', twilio_caller_id: TO, name: '細入', max_recording_length: 0 });
  });

  it('/main: 名簿外はReject', async () => {
    const res = await post('/main', { To: TO, From: '+819999' });
    expect(await res.text()).toContain('<Reject></Reject>');
  });

  it('/main: recorderには録音案内を含むGather', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    const res = await post('/main', { To: TO, From: '+8190' });
    const xml = await res.text();
    expect(xml).toContain('<Gather action="/router" numDigits="1">');
    expect(xml).toContain('録音する場合は3');
  });

  it('/main: listenerには再生案内のみ', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8191', contact_type: 'listener', name: '花子' });
    const res = await post('/main', { To: TO, From: '+8191' });
    const xml = await res.text();
    expect(xml).toContain('最新の録音を聞く場合は1');
    expect(xml).not.toContain('録音する場合は3');
  });

  it('/router: 1 は /replay へリダイレクト', async () => {
    const res = await post('/router', { To: TO, From: '+8191', Digits: '1' });
    expect(await res.text()).toContain('<Redirect>/replay</Redirect>');
  });

  it('/router: 3 は recorder なら /record', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    const res = await post('/router', { To: TO, From: '+8190', Digits: '3' });
    expect(await res.text()).toContain('<Redirect>/record</Redirect>');
  });

  it('/router: 3 は非recorderなら不許可メッセージ', async () => {
    const res = await post('/router', { To: TO, From: '+8191', Digits: '3' });
    const xml = await res.text();
    expect(xml).toContain('その操作は許可されていません');
    expect(xml).toContain('<Redirect>/main</Redirect>');
  });

  it('/record: 録音案内とRecordを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8192', contact_type: 'listener', name: 'L' });
    const res = await post('/record', { To: TO, From: '+8190' });
    const xml = await res.text();
    expect(xml).toContain('1人に送信されます');
    expect(xml).toContain('recordingStatusCallbackMethod="GET"');
    expect(xml).toContain('maxLength="50"');
  });

  it('/hangup: Hangup', async () => {
    const res = await post('/hangup', {});
    expect(await res.text()).toContain('<Hangup></Hangup>');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- twilio-ivr`
Expected: FAIL（`src/routes/twilio` 未実装）

- [ ] **Step 3: src/routes/twilio.ts を実装（/main, /router, /record, /hangup）**

```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { TwiML } from '../twiml';
import { findContact, findRecorder, listListeners } from '../db/contacts';
import {
  parseParams, twimlResponse, errorTwiml, resolveTenantByTo, assertTwilioSignature, type Ctx,
} from './helpers';

export const twilioRoutes = new Hono<{ Bindings: Env }>();

async function handleMain(c: Ctx) {
  const params = await parseParams(c);
  const tenant = await resolveTenantByTo(c, params);
  if (!tenant) return errorTwiml(c);
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  const from = params.From ?? '';
  const contact = await findContact(c.env.DB, tenant.tenantId, from);
  if (!contact) return twimlResponse(c, new TwiML().reject());

  const recorder = await findRecorder(c.env.DB, tenant.tenantId, from);
  const isRecorder = recorder !== null;

  const twiml = new TwiML().gather('/router', 1, (g) => {
    if (isRecorder) {
      g.say(`${tenant.name}の電話連絡網です。録音する場合は3を、最新の録音を聞く場合は1を押してください。`);
    } else {
      g.say(`${tenant.name}の電話連絡網です。最新の録音を聞く場合は1を押してください。`);
    }
  });
  twiml.say('入力が確認できませんでした。');
  return twimlResponse(c, twiml);
}

async function handleRouter(c: Ctx) {
  const params = await parseParams(c);
  const tenant = await resolveTenantByTo(c, params);
  if (!tenant) return errorTwiml(c);
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  const digits = params.Digits ?? '';
  const from = params.From ?? '';
  const twiml = new TwiML();

  if (digits === '1') {
    twiml.redirect('/replay');
  } else if (digits === '3') {
    const recorder = await findRecorder(c.env.DB, tenant.tenantId, from);
    if (recorder) twiml.redirect('/record');
    else { twiml.say('その操作は許可されていません。'); twiml.redirect('/main'); }
  } else {
    twiml.say('入力が正しくありません。'); twiml.redirect('/main');
  }
  return twimlResponse(c, twiml);
}

async function handleRecord(c: Ctx) {
  const params = await parseParams(c);
  const tenant = await resolveTenantByTo(c, params);
  if (!tenant) return errorTwiml(c);
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  const from = params.From ?? '';
  const listeners = await listListeners(c.env.DB, tenant.tenantId);
  const maxLength = tenant.maxRecordingLength === 0 ? 50 : tenant.maxRecordingLength;
  const callbackUrl = `/dial?Caller=${encodeURIComponent(from)}&TenantID=${encodeURIComponent(tenant.tenantId)}`;

  const twiml = new TwiML()
    .say(`録音を開始します。このメッセージは${listeners.length}人に送信されます。発信音の後にメッセージを録音してください。終了したら電話を切ってください。`)
    .record('/hangup', callbackUrl, maxLength);
  return twimlResponse(c, twiml);
}

function handleHangup(c: Ctx) {
  return twimlResponse(c, new TwiML().hangup());
}

twilioRoutes.get('/main', handleMain);
twilioRoutes.post('/main', handleMain);
twilioRoutes.post('/router', handleRouter);
twilioRoutes.get('/record', handleRecord);
twilioRoutes.post('/record', handleRecord);
twilioRoutes.post('/hangup', handleHangup);
```

- [ ] **Step 4: src/index.ts に twilioRoutes をマウント**

`app.all('*', ...)`（アセットフォールバック）より前に追加すること。

```ts
import { Hono } from 'hono';
import type { Env } from './env';
import { twilioRoutes } from './routes/twilio';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/', twilioRoutes);

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npm test -- twilio-ivr`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: Twilio webhookルート(/main /router /record /hangup)を追加"
```

---

## Task 10: 再生・発信ルート（/replay, /play, /dial）

**Files:**
- Modify: `src/routes/twilio.ts`（差し替え可能ファクトリ + 3ルート + formatRecordingDate を追加）
- Test: `test/routes/twilio-playback.test.ts`

**Interfaces:**
- Produces（`src/routes/twilio.ts` に追加・export）:
  - `type TwilioClientLike = Pick<TwilioClient, 'makeCall' | 'listRecordings' | 'getCallFrom' | 'listUsageRecords'>`
  - `setTwilioClientFactory(f: (t: Tenant) => TwilioClientLike): void`（テスト差し替え用）
  - `getTwilioClient(t: Tenant): TwilioClientLike`（admin から利用）
  - `formatRecordingDate(dateCreated: string): string`（RFC1123Z → `M月D日H時M分`、JST。パース不可なら入力そのまま）
  - ルート: `GET/POST /replay`, `GET/POST /play`, `GET /dial`

- [ ] **Step 1: 失敗するテストを書く（test/routes/twilio-playback.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { applyMigrations, seedTenant, seedContact } from '../helpers/db';
import { setTwilioClientFactory, formatRecordingDate } from '../../src/routes/twilio';

const TO = '+815000000001';

describe('playback/dial routes', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({ tenant_id: 'hosoiri', twilio_caller_id: TO, name: '細入', domain: 'h.example' });
  });

  it('formatRecordingDate: RFC1123Z を JST表記に', () => {
    expect(formatRecordingDate('Sun, 23 Jun 2024 00:30:00 +0000')).toBe('6月23日9時30分');
  });

  it('/replay: 録音なしは「録音がありません」', async () => {
    setTwilioClientFactory(() => ({ listRecordings: async () => [], getCallFrom: async () => '' }) as any);
    const res = await app.request(`/replay?To=${encodeURIComponent(TO)}`, {}, env);
    expect(await res.text()).toContain('録音がありません');
  });

  it('/replay: 最新録音を再生（録音者名付き）', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    setTwilioClientFactory(() => ({
      listRecordings: async () => [{ sid: 'RE1', callSid: 'CA1', duration: '5', dateCreated: 'Sun, 23 Jun 2024 00:30:00 +0000', uri: '/x.json' }],
      getCallFrom: async () => '+8190',
    }) as any);
    const res = await app.request(`/replay?To=${encodeURIComponent(TO)}`, {}, env);
    const xml = await res.text();
    expect(xml).toContain('太郎');
    expect(xml).toContain('<Play>https://api.twilio.com/x</Play>');
  });

  it('/play: テナント名と録音者名・Playを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    const url = `/play?TenantID=hosoiri&Recorder=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, env);
    const xml = await res.text();
    expect(xml).toContain('細入');
    expect(xml).toContain('太郎');
    expect(xml).toContain('<Play>https://x/a.mp3</Play>');
  });

  it('/dial: 各listenerにmakeCallし空Responseを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8181', contact_type: 'listener', name: 'L1' });
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8182', contact_type: 'listener', name: 'L2' });
    const calls: string[] = [];
    setTwilioClientFactory(() => ({ makeCall: async (to: string) => { calls.push(to); } }) as any);
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, env);
    expect(calls.sort()).toEqual(['+8181', '+8182']);
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- twilio-playback`
Expected: FAIL（ルート/関数未実装）

- [ ] **Step 3: src/routes/twilio.ts の import 群に追記**

```ts
import type { Tenant } from '../db/types';
import { TwilioClient, recordingUrl } from '../twilio/client';
import { getTenant } from '../db/tenants';
```

- [ ] **Step 4: src/routes/twilio.ts に差し替え可能ファクトリと関数を追加**

`export const twilioRoutes = ...` の直後に追記:

```ts
// テスト差し替え可能な Twilio クライアント生成
export type TwilioClientLike = Pick<TwilioClient, 'makeCall' | 'listRecordings' | 'getCallFrom' | 'listUsageRecords'>;
let twilioClientFactory: (t: Tenant) => TwilioClientLike =
  (t) => new TwilioClient(t.twilioAccountSid, t.twilioAuthToken);
export function setTwilioClientFactory(f: (t: Tenant) => TwilioClientLike) { twilioClientFactory = f; }
export function getTwilioClient(t: Tenant): TwilioClientLike { return twilioClientFactory(t); }

// RFC1123Z → "M月D日H時M分"（JST）
export function formatRecordingDate(dateCreated: string): string {
  const ms = Date.parse(dateCreated);
  if (Number.isNaN(ms)) return dateCreated;
  const jst = new Date(ms + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日${jst.getUTCHours()}時${jst.getUTCMinutes()}分`;
}
```

- [ ] **Step 5: src/routes/twilio.ts に 3ハンドラとルート登録を追加**

既存ルート登録（`twilioRoutes.post('/hangup', handleHangup)` 等）の下に追記:

```ts
async function handleReplay(c: Ctx) {
  const params = await parseParams(c);
  const tenant = await resolveTenantByTo(c, params);
  if (!tenant) return errorTwiml(c);
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  const client = getTwilioClient(tenant);
  const recordings = await client.listRecordings(1);
  const twiml = new TwiML();
  if (recordings.length === 0) { twiml.say('録音がありません。'); return twimlResponse(c, twiml); }

  const rec = recordings[0];
  let recorderName = '不明';
  const callFrom = await client.getCallFrom(rec.callSid).catch(() => '');
  if (callFrom) {
    const contact = await findRecorder(c.env.DB, tenant.tenantId, callFrom);
    if (contact) recorderName = contact.name;
  }
  const dateStr = formatRecordingDate(rec.dateCreated);
  twiml.say(`最新の録音、${dateStr}、${recorderName}からのお知らせを再生します。`)
    .pause(1).play(recordingUrl(rec.uri)).pause(1).say('以上で再生を終わります。');
  return twimlResponse(c, twiml);
}

async function handlePlay(c: Ctx) {
  const params = await parseParams(c);
  const tenantId = params.TenantID ?? '';
  const recorder = params.Recorder ?? '';
  const recUrl = params.RecordingUrl ?? '';
  const tenant = await getTenant(c.env.DB, tenantId);
  if (!tenant) return errorTwiml(c);

  let recorderName = '不明';
  const contact = await findRecorder(c.env.DB, tenantId, recorder);
  if (contact) recorderName = contact.name;

  const twiml = new TwiML()
    .say(`こんにちは。${tenant.name}、${recorderName}からのお知らせです。`)
    .pause(1).play(recUrl).pause(1)
    .say('以上でお知らせを終わります。お聞きいただきありがとうございました。');
  return twimlResponse(c, twiml);
}

async function handleDial(c: Ctx) {
  const params = await parseParams(c);
  const tenantId = params.TenantID ?? '';
  const caller = params.Caller ?? '';
  const recUrl = params.RecordingUrl ?? '';
  if (!tenantId || !caller || !recUrl) return errorTwiml(c);

  const tenant = await getTenant(c.env.DB, tenantId);
  if (!tenant) return errorTwiml(c);
  const listeners = await listListeners(c.env.DB, tenantId);
  const client = getTwilioClient(tenant);

  const playUrl = `https://${tenant.domain}/play?Recorder=${encodeURIComponent(caller)}&RecordingUrl=${encodeURIComponent(recUrl)}&TenantID=${encodeURIComponent(tenantId)}`;

  await Promise.all(listeners.map((l) =>
    client.makeCall(l.phoneNumber, tenant.twilioCallerId, playUrl).catch((e) => {
      console.log(`WARN: ${l.phoneNumber} への発信失敗: ${e}`);
    }),
  ));
  return twimlResponse(c, new TwiML());
}

twilioRoutes.get('/replay', handleReplay);
twilioRoutes.post('/replay', handleReplay);
twilioRoutes.get('/play', handlePlay);
twilioRoutes.post('/play', handlePlay);
twilioRoutes.get('/dial', handleDial);
```

注: `findRecorder` / `listListeners` / `TwiML` 等 Task 9 で import 済みのものは再 import しない。`getTenant`, `recordingUrl`, `Tenant`, `TwilioClient` は Step 3 で追加済み。

- [ ] **Step 6: テストを実行して成功を確認**

Run: `npm test -- twilio-playback`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 再生・一斉発信ルート(/replay /play /dial)を追加"
```

---

## Task 11: Cloudflare Access JWT 検証ミドルウェア

**Files:**
- Create: `src/auth/access.ts`
- Test: `test/auth/access.test.ts`

**Interfaces:**
- Produces（`src/auth/access.ts`）:
  - `accessMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: { userEmail: string } }>`
    - `ACCESS_ENABLED !== 'true'`: 検証スキップ、`c.set('userEmail','dev@local')`、通過。
    - `'true'`: `Cf-Access-Jwt-Assertion` のJWTを検証（iss=`https://<TEAM_DOMAIN>`、aud に `ACCESS_AUD` を含む、exp未超過、JWKS署名RS256）。失敗時401、成功時 `c.set('userEmail', payload.email)`。

- [ ] **Step 1: 失敗するテストを書く（test/auth/access.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { accessMiddleware } from '../../src/auth/access';
import type { Env } from '../../src/env';

function appWith(envOverride: Partial<Env>) {
  const a = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();
  a.use('/admin/*', accessMiddleware);
  a.get('/admin/whoami', (c) => c.json({ email: c.get('userEmail') }));
  return (path: string) => a.request(path, {}, { ...env, ...envOverride } as any);
}

describe('accessMiddleware', () => {
  it('ACCESS_ENABLED=false は dev ユーザーで通過', async () => {
    const res = await appWith({ ACCESS_ENABLED: 'false' })('/admin/whoami');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'dev@local' });
  });

  it('ACCESS_ENABLED=true でJWT無しは401', async () => {
    const res = await appWith({ ACCESS_ENABLED: 'true', ACCESS_AUD: 'aud', ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com' })('/admin/whoami');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- access`
Expected: FAIL（`src/auth/access` 未実装）

- [ ] **Step 3: src/auth/access.ts を実装**

```ts
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

interface Jwk { kid: string; kty: string; alg?: string; n: string; e: string; use?: string; }
let jwksCache: { domain: string; keys: Jwk[] } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJson(seg: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

async function fetchJwks(teamDomain: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.domain === teamDomain) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  const data = await res.json() as { keys: Jwk[] };
  jwksCache = { domain: teamDomain, keys: data.keys };
  return data.keys;
}

export const accessMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: { userEmail: string } }> = async (c, next) => {
  if (c.env.ACCESS_ENABLED !== 'true') {
    c.set('userEmail', 'dev@local');
    return next();
  }

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const parts = token.split('.');
  if (parts.length !== 3) return c.json({ error: 'unauthorized' }, 401);

  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);

    const expectedIss = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
    if (payload.iss !== expectedIss) return c.json({ error: 'bad issuer' }, 401);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(c.env.ACCESS_AUD)) return c.json({ error: 'bad audience' }, 401);
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return c.json({ error: 'expired' }, 401);

    const jwks = await fetchJwks(c.env.ACCESS_TEAM_DOMAIN);
    const jwk = jwks.find((k) => k.kid === header.kid);
    if (!jwk) return c.json({ error: 'unknown key' }, 401);

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
    if (!ok) return c.json({ error: 'bad signature' }, 401);

    c.set('userEmail', payload.email ?? 'unknown');
    return next();
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
};
```

注: `Date.now()` はWorkersランタイムで利用可能。

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- access`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: Cloudflare Access JWT検証ミドルウェアを追加"
```

---

## Task 12: 管理API ルート（contacts CRUD + recordings + usage）

**Files:**
- Create: `src/routes/admin.ts`
- Modify: `src/index.ts`（`/admin/*` に accessMiddleware と adminRoutes をマウント）
- Test: `test/routes/admin.test.ts`

**Interfaces:**
- Consumes: db/contacts, db/tenants, accessMiddleware（Task 11）, `getTwilioClient`（Task 10）
- Produces（`src/routes/admin.ts`）: `adminRoutes: Hono<{ Bindings: Env; Variables: { userEmail: string } }>`:
  - `GET /admin/:tenantId/contacts` → `Contact[]`
  - `POST /admin/:tenantId/contacts` → 201 + Contact（`{ phoneNumber, name, contactType }`、type は recorder/listener のみ）
  - `DELETE /admin/:tenantId/contacts/:contactKey` → 204（contactKey はデコード）
  - `GET /admin/:tenantId/recordings` → `listRecordings(200)`
  - `GET /admin/:tenantId/usage?start_date&end_date` → `listUsageRecords`（両方必須）

- [ ] **Step 1: 失敗するテストを書く（test/routes/admin.test.ts）**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { applyMigrations, seedTenant, seedContact } from '../helpers/db';
import { setTwilioClientFactory } from '../../src/routes/twilio';

describe('admin routes', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({ tenant_id: 'hosoiri' });
  });

  it('GET contacts: 空配列', async () => {
    const res = await app.request('/admin/hosoiri/contacts', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('POST contacts: 作成し201', async () => {
    const res = await app.request('/admin/hosoiri/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+8190', name: '太郎', contactType: 'recorder' }),
    }, env);
    expect(res.status).toBe(201);
    expect((await res.json<any>()).contactKey).toBe('recorder#+8190');
  });

  it('POST contacts: 不正なcontactTypeは400', async () => {
    const res = await app.request('/admin/hosoiri/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+8190', name: '太郎', contactType: 'bad' }),
    }, env);
    expect(res.status).toBe(400);
  });

  it('DELETE contacts: 204', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder' });
    const res = await app.request(`/admin/hosoiri/contacts/${encodeURIComponent('recorder#+8190')}`, { method: 'DELETE' }, env);
    expect(res.status).toBe(204);
  });

  it('GET recordings: Twilioクライアント結果を返す', async () => {
    setTwilioClientFactory(() => ({ listRecordings: async () => [{ sid: 'RE1', callSid: 'CA1', duration: '1', dateCreated: 'd', uri: '/u' }] }) as any);
    const res = await app.request('/admin/hosoiri/recordings', {}, env);
    expect((await res.json<any[]>())[0].sid).toBe('RE1');
  });

  it('GET usage: start/end 必須', async () => {
    const res = await app.request('/admin/hosoiri/usage', {}, env);
    expect(res.status).toBe(400);
  });

  it('GET usage: 結果を返す', async () => {
    setTwilioClientFactory(() => ({ listUsageRecords: async () => [{ category: 'calls', startDate: 's', endDate: 'e', count: '1', countUnit: 'c', usage: '1', usageUnit: 'min', price: '0' }] }) as any);
    const res = await app.request('/admin/hosoiri/usage?start_date=2024-01-01&end_date=2024-01-31', {}, env);
    expect((await res.json<any[]>())[0].category).toBe('calls');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- admin`
Expected: FAIL（`src/routes/admin` 未実装 / マウント未）

- [ ] **Step 3: src/routes/admin.ts を実装**

```ts
import { Hono } from 'hono';
import type { Env } from '../env';
import { getTenant } from '../db/tenants';
import { listAllContacts, createContact, deleteContact } from '../db/contacts';
import { getTwilioClient } from './twilio';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();

adminRoutes.get('/admin/:tenantId/contacts', async (c) => {
  const tenantId = c.req.param('tenantId');
  return c.json(await listAllContacts(c.env.DB, tenantId));
});

adminRoutes.post('/admin/:tenantId/contacts', async (c) => {
  const tenantId = c.req.param('tenantId');
  let input: { phoneNumber?: string; name?: string; contactType?: string };
  try { input = await c.req.json(); } catch { return c.text('リクエストが不正です', 400); }
  if (input.contactType !== 'recorder' && input.contactType !== 'listener') {
    return c.text('contactType は recorder または listener', 400);
  }
  const contact = {
    tenantId,
    contactKey: `${input.contactType}#${input.phoneNumber ?? ''}`,
    name: input.name ?? '',
    phoneNumber: input.phoneNumber ?? '',
    contactType: input.contactType,
  } as const;
  await createContact(c.env.DB, contact);
  return c.json(contact, 201);
});

adminRoutes.delete('/admin/:tenantId/contacts/:contactKey', async (c) => {
  const tenantId = c.req.param('tenantId');
  const contactKey = decodeURIComponent(c.req.param('contactKey'));
  await deleteContact(c.env.DB, tenantId, contactKey);
  return c.body(null, 204);
});

adminRoutes.get('/admin/:tenantId/recordings', async (c) => {
  const tenantId = c.req.param('tenantId');
  const tenant = await getTenant(c.env.DB, tenantId);
  if (!tenant) return c.text('テナントが見つかりません', 404);
  return c.json(await getTwilioClient(tenant).listRecordings(200));
});

adminRoutes.get('/admin/:tenantId/usage', async (c) => {
  const tenantId = c.req.param('tenantId');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  if (!startDate || !endDate) return c.text('start_date と end_date は必須です', 400);
  const tenant = await getTenant(c.env.DB, tenantId);
  if (!tenant) return c.text('テナントが見つかりません', 404);
  return c.json(await getTwilioClient(tenant).listUsageRecords(startDate, endDate));
});
```

- [ ] **Step 4: src/index.ts に Access + adminRoutes をマウント**

twilioRoutes の後、アセットフォールバックより前。

```ts
import { Hono } from 'hono';
import type { Env } from './env';
import { twilioRoutes } from './routes/twilio';
import { accessMiddleware } from './auth/access';
import { adminRoutes } from './routes/admin';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/', twilioRoutes);

app.use('/admin/*', accessMiddleware);
app.route('/', adminRoutes);

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npm test -- admin`
Expected: PASS

- [ ] **Step 6: 全テスト・型チェック**

Run: `npm test && npm run typecheck`
Expected: 全PASS、型エラーなし

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 管理API(contacts CRUD / recordings / usage)とAccess適用を追加"
```

---

## Task 13: フロントエンド（Next.js静的サイトの移植・Amplify撤去・Access cookie認証）

**Files:**
- Create: `web/`（移植元 `packages/web/` からコピーして改変）
- Modify: `web/src/lib/api.ts`（token引数を削除し `credentials: 'include'`）
- Modify: `web/src/app/layout.tsx`（Authenticator撤去）
- Delete: `web/src/lib/auth.ts`
- Modify: `web/package.json`（amplify依存削除）

**Interfaces:**
- Produces: `web/out/`（`next build` の静的出力。Worker の `ASSETS` が配信）

注: 認証はAccessがエッジで処理するためフロントに認証コードは不要。`/admin/*` への fetch は同一オリジンcookieで通る（`credentials: 'include'`）。ログアウトは `/cdn-cgi/access/logout`。ユーザー表示は `/cdn-cgi/access/get-identity`（`email`）。

- [ ] **Step 1: 移植元webをコピー**

```bash
SRC=/Users/the_red/ghq/github.com/the-red/yagiphone/packages/web
mkdir -p web
cp -R "$SRC/src" web/src
cp "$SRC/next.config.ts" "$SRC/tsconfig.json" "$SRC/package.json" web/
cp "$SRC/postcss.config.mjs" web/ 2>/dev/null || true
```

- [ ] **Step 2: web/package.json から Amplify を削除**

`dependencies` から `aws-amplify` と `@aws-amplify/ui-react` を削除。`name` を `@yagiphone-cloudflare/web` に変更。`scripts.build` = `next build` のまま。

- [ ] **Step 3: web/src/lib/auth.ts を削除**

```bash
rm web/src/lib/auth.ts
```

- [ ] **Step 4: web/src/lib/api.ts を token 非依存に書き換え**

```ts
export interface Contact {
  tenantId: string; contactKey: string; name: string; phoneNumber: string;
  contactType: 'recorder' | 'listener';
}
export interface Recording {
  sid: string; callSid: string; duration: string; dateCreated: string; uri: string;
}
export interface UsageRecord {
  category: string; startDate: string; endDate: string; count: string;
  countUnit: string; usage: string; usageUnit: string; price: string;
}
export interface CreateContactInput {
  phoneNumber: string; name: string; contactType: 'recorder' | 'listener';
}

export class ApiClient {
  constructor(private baseUrl: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`API エラー: ${res.status}`);
    return res.status === 204 ? (undefined as T) : res.json();
  }

  listContacts(tenantId: string) { return this.req<Contact[]>(`/admin/${tenantId}/contacts`); }
  createContact(tenantId: string, input: CreateContactInput) {
    return this.req<Contact>(`/admin/${tenantId}/contacts`, { method: 'POST', body: JSON.stringify(input) });
  }
  deleteContact(tenantId: string, contactKey: string) {
    return this.req<void>(`/admin/${tenantId}/contacts/${encodeURIComponent(contactKey)}`, { method: 'DELETE' });
  }
  listRecordings(tenantId: string) { return this.req<Recording[]>(`/admin/${tenantId}/recordings`); }
  listUsageRecords(tenantId: string, startDate: string, endDate: string) {
    return this.req<UsageRecord[]>(`/admin/${tenantId}/usage?start_date=${startDate}&end_date=${endDate}`);
  }
}
```

`baseUrl` は同一オリジン配信のため空文字でよい（各ページの生成箇所を `new ApiClient('')` に変更。Step 6 で実施）。

- [ ] **Step 5: web/src/app/layout.tsx を Authenticator 非依存に書き換え**

```tsx
'use client';

import { useEffect, useState } from 'react';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState('');

  useEffect(() => {
    fetch('/cdn-cgi/access/get-identity', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.email) setEmail(d.email); })
      .catch(() => {});
  }, []);

  return (
    <html lang="ja">
      <body className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <h1 className="text-xl font-bold text-gray-900">yagiphone 管理画面</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{email}</span>
              <a href="/cdn-cgi/access/logout" className="text-sm text-red-600 hover:text-red-800">ログアウト</a>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: token を渡している箇所を全て修正**

移植元の各ページ/コンポーネントは `fetchAuthSession()` でトークンを取得しAPIに渡している。grep で洗い出して順に修正:

```bash
cd web && grep -rn "token\|fetchAuthSession\|aws-amplify\|Authenticator\|NEXT_PUBLIC_API_URL" src
```

各ヒットについて:
- `aws-amplify` / `fetchAuthSession` / `getCurrentUser` の import・呼び出しを削除。
- API呼び出しから `token` 引数を除去（例: `api.listContacts(tenantId, token)` → `api.listContacts(tenantId)`）。
- `new ApiClient(process.env.NEXT_PUBLIC_API_URL!)` を `new ApiClient('')` に変更。

修正後、再度 grep がアプリコードで0件（コメント除く）になることを確認。

- [ ] **Step 7: ビルドして静的出力を生成**

Run:
```bash
cd web && npm install && npm run build
```
Expected: `web/out/` が生成される。エラーは大半が未削除のtoken/amplify参照。該当を修正して再ビルド。

- [ ] **Step 8: Worker経由で静的配信を確認（手動）**

Run（リポジトリルート）:
```bash
npm run migrate:local
npx wrangler dev
```
`http://localhost:8787/`（SPA）、`/health`、`/admin/<tenant>/contacts`（JSON、`ACCESS_ENABLED=false`）を確認。

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "feat: フロントエンドを移植しAmplify撤去・Access cookie認証へ変更"
```

---

## Task 14: 開発デプロイとドキュメント整備

**Files:**
- Create: `README.md`
- Create: `.gitignore`
- Modify: `wrangler.jsonc`（`database_id` 記入）
- Modify: `HANDOFF.md`（実装状況を更新）

**Interfaces:** なし（運用タスク）

- [ ] **Step 1: .gitignore を作成**

```
node_modules/
web/node_modules/
web/out/
web/.next/
.wrangler/
seed.sql
.dev.vars
```

- [ ] **Step 2: D1本番DB作成とID記入**

```bash
npx wrangler d1 create yagiphone
# 出力の database_id を wrangler.jsonc の d1_databases[0].database_id に記入
npm run migrate:remote
```

- [ ] **Step 3: 移植元データの投入（任意）**

移植元 DynamoDB の tenants/contacts を `INSERT` 文化した `seed.sql` を作り `wrangler d1 execute yagiphone --remote --file=seed.sql` で投入。Twilio認証情報を含むため `seed.sql` はコミットしない（`.gitignore` 済み）。

- [ ] **Step 4: デプロイ**

```bash
npm test && npm run typecheck
cd web && npm run build && cd ..
npx wrangler deploy
```
Expected: `*.workers.dev` URL 発行。

- [ ] **Step 5: 動作確認（手動）**

- `https://<name>.<subdomain>.workers.dev/health` → `{"status":"ok"}`
- `/` → 管理画面SPA表示
- dev用Twilio番号があれば着信テスト

- [ ] **Step 6: README.md を作成**

セットアップ・テスト・デプロイ手順、環境変数（`ACCESS_ENABLED`/`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`/`TWILIO_VALIDATE`）、Access有効化手順を記載。

- [ ] **Step 7: HANDOFF.md を実装済み状態に更新**

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "docs: README追加・デプロイ手順整備・HANDOFF更新"
```

---

## カスタムドメイン + Access 有効化（将来・ドメイン確定後の運用作業）

実装計画外。手順の要点:
1. `wrangler.jsonc` に `routes`（カスタムドメイン）を追加しデプロイ。
2. Cloudflare Zero Trust で Accessアプリを作成（Web UI全般 / `/admin/*`）。Twilio webhookパス（/main /router /record /play /replay /dial /hangup /health）は Bypass。
3. Access Application の Audience(AUD) tag と team domain を取得し、`wrangler.jsonc` vars の `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` に設定、`ACCESS_ENABLED=true`。
4. `TWILIO_VALIDATE=true` で署名検証を有効化。
5. Twilio コンソールの各 Webhook URL を新ドメインへ更新。

---

## 自己レビュー結果（spec照合）

- **静的配信（S3+CloudFront相当）** → Task 1（ASSETSフォールバック）, Task 13（web移植）✓
- **Lambda(Go) → Worker+Hono** → Task 9, 10, 12 ✓
- **DynamoDB → D1**（tenants/contacts、begins_with→contact_type、callerId索引） → Task 2, 3, 4 ✓
- **Cognito → Access**（JWT検証、cookie認証、Amplify撤去） → Task 11, 13 ✓
- **Twilio連携**（makeCall/listRecordings/listUsageRecords/getCallFrom/recordingUrl） → Task 6 ✓
- **Twilio署名検証（新規）** → Task 7, 8（適用は各Twilioルート）✓
- **全ルート**（/health /main /router /record /hangup /replay /play /dial /admin/*） → Task 1, 9, 10, 12 ✓
- **TwiML（ja-JP/Polly.Mizuki）** → Task 5 ✓
- **テスト（Vitest + workers-pool）** → 全タスク ✓
- **dev/prod・ドメイン未定対応** → Task 14 + 将来セクション ✓

注意点（実装時に確認）:
- `/dial` は GET（移植元同様 recordingStatusCallback 由来）。`assertTwilioSignature` のGET扱いと整合確認（Task 8 注記）。`/dial` 自体は現状 To でテナント解決していない（TenantIDパラメータ）ため、署名検証を有効化する場合は `getTenant` 後にトークンを得て検証する追加実装が必要。MVPでは `TWILIO_VALIDATE=false` で運用し、有効化時に対応する。
- 署名検証ベクトル（Task 7）は実装時に公式値で再確認。
- `applyD1Migrations`/`readD1Migrations` のAPIは導入バージョンで要確認（Task 2 注記）。
- 型注釈の `res.json<T>()` はHonoのクライアント型に依存。動かない場合は `(await res.json()) as T` に変更。
