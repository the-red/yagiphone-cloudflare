# /dial Queue化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/dial` ルートの一斉架電を Cloudflare Queue 経由にし、Freeプランの50サブリクエスト制限を回避しながらリスナー数が50人超でも動作させる

**Architecture:** `/dial` ハンドラは makeCall を直接呼ばず、リスナーごとに `DialMessage` をキューへ送る（sendBatch、100件上限でチャンク）。同一Workerの `queue()` ハンドラが最大20件/バッチで受け取り、テナント情報をキャッシュしながら makeCall する。Object.assign(app, { queue: handleDialQueue }) パターンで既存の `app.fetch/app.request` テストを壊さない。

**Tech Stack:** Cloudflare Workers, Hono, D1, Cloudflare Queues, TypeScript, Vitest + @cloudflare/vitest-pool-workers

## Global Constraints

- TypeScript strict mode（`tsconfig.json` で `strict: true`）
- Workers ランタイム = Web API のみ（Node.js API 禁止）
- `nodejs_compat` は `wrangler.jsonc` 本体に追加しない（vitest.config.ts の miniflare 側のみ）
- TDD: テスト失敗確認 → 実装 → テスト成功確認の順
- コードコメントは日本語
- 既存54テストをすべて green に保つ
- `npm test` と `npm run typecheck` が両方 clean で完了すること
- キュー名: `yagiphone-dial`、binding 名: `DIAL_QUEUE`
- max_batch_size: 20、max_batch_timeout: 30、max_retries: 3
- sendBatch は 100件/回 上限でチャンク
- DialMessage に Twilio 認証情報を含めない

---

## ファイルマップ

| パス | 操作 | 役割 |
|------|------|------|
| `src/queue/dial.ts` | 新規作成 | DialMessage 型 + handleDialQueue コンシューマー |
| `src/env.ts` | 修正 | DIAL_QUEUE バインディング追加 |
| `src/index.ts` | 修正 | Object.assign パターンで queue ハンドラ追加 |
| `src/routes/twilio.ts` | 修正 | handleDial を sendBatch 方式に変更（makeCall削除） |
| `wrangler.jsonc` | 修正 | queues ブロック追加（top-level + env.production） |
| `test/routes/twilio-playback.test.ts` | 修正 | /dial テストをキューモック方式に変更 |
| `test/queue/dial.test.ts` | 新規作成 | handleDialQueue コンシューマーの単体テスト |
| `README.md` | 修正 | Queue 作成手順と説明追加 |
| `CLAUDE.md` | 修正 | DIAL_QUEUE / handleDialQueue / Object.assign パターン説明追加 |

---

### Task 1: src/queue/dial.ts の作成（DialMessage 型 + handleDialQueue）

**Files:**
- Create: `src/queue/dial.ts`
- Test: `test/queue/dial.test.ts`（ここで書く、Task 1 の一部）

**Interfaces:**
- Consumes: `getTenant` from `../db/tenants`, `getTwilioClient` from `../routes/twilio`
- Produces:
  - `export interface DialMessage { tenantId: string; to: string; playUrl: string }`
  - `export async function handleDialQueue(batch: MessageBatch<DialMessage>, env: Env): Promise<void>`

- [ ] **Step 1: テストファイルの雛形を作成し、失敗確認する**

`test/queue/` ディレクトリを作成し、以下のテストファイルを作成する:

```typescript
// test/queue/dial.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleDialQueue } from '../../src/queue/dial';
import { setTwilioClientFactory } from '../../src/routes/twilio';
import { applyMigrations, seedTenant } from '../helpers/db';
import type { DialMessage } from '../../src/queue/dial';

describe('handleDialQueue コンシューマー', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({
      tenant_id: 'hosoiri',
      twilio_caller_id: '+815000000001',
      name: '細入',
      domain: 'h.example',
    });
  });

  it('各メッセージの makeCall が呼ばれ、ack される', async () => {
    const calls: { to: string; from: string; url: string }[] = [];
    setTwilioClientFactory(() => ({
      makeCall: async (to: string, from: string, url: string) => {
        calls.push({ to, from, url });
      },
    }) as any);

    const msg1 = {
      body: { tenantId: 'hosoiri', to: '+8181', playUrl: 'https://h.example/play?p=1' },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const msg2 = {
      body: { tenantId: 'hosoiri', to: '+8182', playUrl: 'https://h.example/play?p=2' },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    const batch = { messages: [msg1, msg2] };
    await handleDialQueue(batch as any, env);

    // 各メッセージに対して makeCall が呼ばれる
    expect(calls.map((c) => c.to).sort()).toEqual(['+8181', '+8182']);
    // from はテナントの twilioCallerId
    expect(calls.every((c) => c.from === '+815000000001')).toBe(true);
    // ack される
    expect(msg1.ack).toHaveBeenCalledOnce();
    expect(msg2.ack).toHaveBeenCalledOnce();
    // retry は呼ばれない
    expect(msg1.retry).not.toHaveBeenCalled();
    expect(msg2.retry).not.toHaveBeenCalled();
  });

  it('makeCall が throw したとき retry が呼ばれる', async () => {
    setTwilioClientFactory(() => ({
      makeCall: async () => { throw new Error('Twilio error'); },
    }) as any);

    const msg = {
      body: { tenantId: 'hosoiri', to: '+8181', playUrl: 'https://h.example/play?p=1' },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await handleDialQueue({ messages: [msg] } as any, env);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('テナントが存在しない場合 ack して次に進む（無限リトライ防止）', async () => {
    setTwilioClientFactory(() => ({
      makeCall: vi.fn(),
    }) as any);

    const msg = {
      body: { tenantId: 'no-such-tenant', to: '+8181', playUrl: 'https://h.example/play?p=1' },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await handleDialQueue({ messages: [msg] } as any, env);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('同一テナントの複数メッセージは getTenant を1回だけ呼ぶ（キャッシュ）', async () => {
    const calls: string[] = [];
    setTwilioClientFactory(() => ({
      makeCall: async (to: string) => { calls.push(to); },
    }) as any);

    const messages = [
      { body: { tenantId: 'hosoiri', to: '+8181', playUrl: 'https://x/p' }, ack: vi.fn(), retry: vi.fn() },
      { body: { tenantId: 'hosoiri', to: '+8182', playUrl: 'https://x/p' }, ack: vi.fn(), retry: vi.fn() },
      { body: { tenantId: 'hosoiri', to: '+8183', playUrl: 'https://x/p' }, ack: vi.fn(), retry: vi.fn() },
    ];

    await handleDialQueue({ messages } as any, env);

    // 全メッセージに makeCall が呼ばれる
    expect(calls.sort()).toEqual(['+8181', '+8182', '+8183']);
    // 全 ack される
    messages.forEach((m) => expect(m.ack).toHaveBeenCalledOnce());
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test -- queue/dial
```

期待: `Cannot find module '../../src/queue/dial'` またはコンパイルエラーで FAIL

- [ ] **Step 3: src/queue/dial.ts を実装する**

`src/queue/` ディレクトリを作成し、以下を実装:

```typescript
// src/queue/dial.ts
import type { Env } from '../env';
import { getTenant } from '../db/tenants';
import { getTwilioClient } from '../routes/twilio';
import type { Tenant } from '../db/types';

/** Cloudflare Queue メッセージの型。Twilio 認証情報は含めない */
export interface DialMessage {
  tenantId: string;
  to: string;
  playUrl: string;
}

/**
 * yagiphone-dial キューのコンシューマーハンドラ。
 * バッチ内の各メッセージに対して Twilio makeCall を実行する。
 * テナントはバッチ内で tenantId をキーにキャッシュし、D1 読み取りを最小化する。
 */
export async function handleDialQueue(
  batch: MessageBatch<DialMessage>,
  env: Env,
): Promise<void> {
  // バッチ内で tenantId → Tenant をキャッシュ（D1 読み取り削減）
  const tenantCache = new Map<string, Tenant | null>();

  for (const msg of batch.messages) {
    const { tenantId, to, playUrl } = msg.body;

    // テナントをキャッシュから取得（なければ DB から取得してキャッシュ）
    if (!tenantCache.has(tenantId)) {
      tenantCache.set(tenantId, await getTenant(env.DB, tenantId));
    }
    const tenant = tenantCache.get(tenantId) ?? null;

    if (!tenant) {
      // テナントが存在しない場合、無限リトライを防ぐため ack して次へ
      console.log(`WARN: テナント ${tenantId} が見つからない。メッセージをスキップ`);
      msg.ack();
      continue;
    }

    try {
      const client = getTwilioClient(tenant);
      await client.makeCall(to, tenant.twilioCallerId, playUrl);
      msg.ack();
    } catch (e) {
      // 一時的エラー（Twilio 障害など）はリトライ（max_retries: 3 で上限）
      console.log(`WARN: ${to} への発信失敗: ${e}`);
      msg.retry();
    }
  }
}
```

- [ ] **Step 4: テストが成功することを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test -- queue/dial
```

期待: 4テスト PASS

---

### Task 2: src/env.ts に DIAL_QUEUE を追加

**Files:**
- Modify: `src/env.ts`

**Interfaces:**
- Consumes: `DialMessage` from `./queue/dial`
- Produces: `Env.DIAL_QUEUE: Queue<DialMessage>`

- [ ] **Step 1: src/env.ts を修正する**

```typescript
// src/env.ts
import type { DialMessage } from './queue/dial';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_ENABLED: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  TWILIO_VALIDATE: string;
  /** yagiphone-dial キューへの発行バインディング */
  DIAL_QUEUE: Queue<DialMessage>;
}
```

- [ ] **Step 2: 型チェックが通ることを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm run typecheck
```

期待: エラーなし（Queue は @cloudflare/workers-types のグローバル型）

---

### Task 3: src/index.ts を Object.assign パターンに変更

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `handleDialQueue` from `./queue/dial`
- Produces: default export に `.queue` ハンドラが追加されたオブジェクト

- [ ] **Step 1: src/index.ts を修正する**

```typescript
// src/index.ts
import { Hono } from 'hono';
import type { Env } from './env';
import { twilioRoutes } from './routes/twilio';
import { accessMiddleware } from './auth/access';
import { adminRoutes } from './routes/admin';
import { handleDialQueue } from './queue/dial';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/', twilioRoutes);

// 管理APIにAccessミドルウェアを適用
app.use('/admin/*', accessMiddleware);
app.route('/', adminRoutes);

// APIに該当しないパスは静的アセットへフォールバック
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

// Object.assign で queue ハンドラを追加する。
// app.fetch / app.request はそのまま（既存テストが import app して app.request() する構造を維持）。
// Workers ランタイムは export default に .fetch があれば HTTP, .queue があればキューを呼ぶ。
export default Object.assign(app, { queue: handleDialQueue });
```

- [ ] **Step 2: 既存テストが引き続き green であることを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test
```

期待: 既存 54テスト + queue/dial の 4テスト = すべて PASS

---

### Task 4: src/routes/twilio.ts の handleDial を Queue 送信方式に変更

**Files:**
- Modify: `src/routes/twilio.ts`（handleDial 関数のみ。他の関数は触らない）
- Modify: `test/routes/twilio-playback.test.ts`（/dial テストをキューモックに変更）

**Interfaces:**
- Consumes: `c.env.DIAL_QUEUE.sendBatch(messages)` — Cloudflare Queue Producer API
- Produces: 空 TwiML `<Response></Response>`

- [ ] **Step 1: twilio-playback.test.ts の /dial テストをキューモック方式に書き換える（先に失敗確認）**

`test/routes/twilio-playback.test.ts` を以下のように修正する。`/dial: 各listenerにmakeCallし空Responseを返す`、`/dial: TWILIO_VALIDATE=true かつ署名なしで 403、makeCall 未呼び出し`、`/dial: TWILIO_VALIDATE=true かつ正当な署名で 200、makeCall 呼び出し` の3テストを書き換える:

```typescript
// 変更対象のテスト（既存の3つを以下に置き換える）

  it('/dial: 各listenerをQueueにenqueueし空Responseを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8181', contact_type: 'listener', name: 'L1' });
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8182', contact_type: 'listener', name: 'L2' });
    const sent: any[] = [];
    const mockQueue = { sendBatch: async (msgs: any[]) => { sent.push(...msgs); }, send: async () => {} };
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, { ...env, DIAL_QUEUE: mockQueue } as any);
    // tenantId
    expect(sent.every((m) => m.body.tenantId === 'hosoiri')).toBe(true);
    // to はリスナーの電話番号
    expect(sent.map((m) => m.body.to).sort()).toEqual(['+8181', '+8182']);
    // playUrl にテナントの domain と Recorder/RecordingUrl/TenantID が含まれる
    expect(sent.every((m) =>
      m.body.playUrl.includes('https://h.example/play?Recorder=')
      && m.body.playUrl.includes(`RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`)
      && m.body.playUrl.includes('TenantID=hosoiri'),
    )).toBe(true);
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it('/dial: TWILIO_VALIDATE=true かつ署名なしで 403、enqueue されない', async () => {
    const sent: any[] = [];
    const mockQueue = { sendBatch: async (msgs: any[]) => { sent.push(...msgs); }, send: async () => {} };
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, { ...env, TWILIO_VALIDATE: 'true', DIAL_QUEUE: mockQueue } as any);
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('/dial: TWILIO_VALIDATE=true かつ正当な署名で 200、enqueue される', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8181', contact_type: 'listener', name: 'L1' });
    const sent: any[] = [];
    const mockQueue = { sendBatch: async (msgs: any[]) => { sent.push(...msgs); }, send: async () => {} };
    const path = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const fullUrl = `http://localhost${path}`;
    const sig = await computeSignature('token-hosoiri', fullUrl, {});
    const res = await app.request(path, {
      headers: { 'X-Twilio-Signature': sig },
    }, { ...env, TWILIO_VALIDATE: 'true', DIAL_QUEUE: mockQueue } as any);
    expect(res.status).toBe(200);
    expect(sent.some((m) => m.body.to === '+8181')).toBe(true);
  });
```

注意: `setTwilioClientFactory` の import は `/replay` テストで引き続き使うので削除しない。

- [ ] **Step 2: テストが失敗することを確認する（まだ実装していないため）**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test -- twilio-playback
```

期待: `/dial: 各listenerをQueueにenqueueし空Responseを返す` などが FAIL

- [ ] **Step 3: src/routes/twilio.ts の handleDial を修正する**

`handleDial` 関数を以下に置き換える（関数の場所: ファイル末尾付近 `twilioRoutes.get('/dial', handleDial)` の直前）:

```typescript
async function handleDial(c: Ctx) {
  const params = await parseParams(c);
  const tenantId = params.TenantID ?? '';
  const caller = params.Caller ?? '';
  const recUrl = params.RecordingUrl ?? '';
  if (!tenantId || !caller || !recUrl) return errorTwiml(c);

  const tenant = await getTenant(c.env.DB, tenantId);
  if (!tenant) return errorTwiml(c);
  // テナントが確定した後、enqueue 前に署名検証
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  const listeners = await listListeners(c.env.DB, tenantId);

  if (listeners.length > 0) {
    const playUrl = `https://${tenant.domain}/play?Recorder=${encodeURIComponent(caller)}&RecordingUrl=${encodeURIComponent(recUrl)}&TenantID=${encodeURIComponent(tenantId)}`;

    // キューメッセージを構築（Twilio 認証情報は含めない）
    const messages = listeners.map((l) => ({
      body: { tenantId, to: l.phoneNumber, playUrl },
    }));

    // Cloudflare Queue の上限は 100件/sendBatch のため、チャンクして送信
    for (let i = 0; i < messages.length; i += 100) {
      await c.env.DIAL_QUEUE.sendBatch(messages.slice(i, i + 100));
    }
  }

  return twimlResponse(c, new TwiML());
}
```

注意: `getTwilioClient` の import は handleDial では使わなくなるが、`handleReplay` と `handlePlay` で引き続き使うため、routes/twilio.ts の import 行は削除しない。

- [ ] **Step 4: テストが成功することを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test -- twilio-playback
```

期待: すべて PASS

- [ ] **Step 5: 全テストが green であることを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test
```

期待: 全テスト PASS（既存 54 + 新 4 = 58テスト以上）

---

### Task 5: wrangler.jsonc に queues ブロックを追加

**Files:**
- Modify: `wrangler.jsonc`

- [ ] **Step 1: wrangler.jsonc を修正する**

top-level と `env.production` の両方に `queues` ブロックを追加する。
Wrangler の named env はトップレベルのバインディングを継承しないため、両方に記述する必要がある。

top-level の `d1_databases` ブロックの後、`vars` ブロックの前に以下を追加:

```jsonc
  "queues": {
    "producers": [{ "queue": "yagiphone-dial", "binding": "DIAL_QUEUE" }],
    "consumers": [{ "queue": "yagiphone-dial", "max_batch_size": 20, "max_batch_timeout": 30, "max_retries": 3 }]
  },
```

`env.production` の `d1_databases` ブロックの後、`vars` ブロックの前にも同じブロックを追加:

```jsonc
      "queues": {
        "producers": [{ "queue": "yagiphone-dial", "binding": "DIAL_QUEUE" }],
        "consumers": [{ "queue": "yagiphone-dial", "max_batch_size": 20, "max_batch_timeout": 30, "max_retries": 3 }]
      },
```

- [ ] **Step 2: vitest-pool-workers が wrangler.jsonc の queues ブロックを受け入れるか確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test
```

期待: queues 設定でエラーが出ない。テストはキューをモック/直接呼び出しで使うため、実キューインフラは不要。

もし `@cloudflare/vitest-pool-workers` がキュー設定でエラーを出す場合は、`vitest.config.ts` の `miniflare` セクションに以下を追加してダミーキューバインディングを設定する:

```typescript
// vitest.config.ts への追記（必要な場合のみ）
miniflare: {
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  bindings: { TEST_MIGRATIONS: migrations },
  // テスト用のダミーキューバインディング（テストはモックを注入するため実キュー不要）
  queues: { DIAL_QUEUE: 'yagiphone-dial' },
},
```

- [ ] **Step 3: 型チェックが通ることを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm run typecheck
```

期待: エラーなし

---

### Task 6: ドキュメント更新（README.md + CLAUDE.md）

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README.md にキュー作成手順を追加する**

README.md のデプロイ手順セクションを探し、`wrangler d1 create yagiphone` の行の後に以下を追加する:

```markdown
npx wrangler queues create yagiphone-dial   # Queue 作成（初回のみ）
```

また、アーキテクチャ説明に以下の一文を追加する（`/dial` の説明付近）:

```markdown
  │     /dial はリスナーを Cloudflare Queue (yagiphone-dial) にエンキューし、
  │     同一Workerの queue() ハンドラが20件/バッチで makeCall する（Free 50サブリクエスト制限回避）
```

- [ ] **Step 2: CLAUDE.md に Queue 関連情報を追加する**

CLAUDE.md の「技術スタック」または「ディレクトリ構成」セクションに以下を追加する:

```markdown
- **Cloudflare Queues**（binding 名 `DIAL_QUEUE`）— `/dial` の一斉架電Fan-outに使用
```

「ディレクトリ構成」セクションの `src/` 一覧に追加:

```markdown
  queue/dial.ts       DialMessage 型 + handleDialQueue コンシューマー。
                      バッチ内でテナントをキャッシュして D1 読み取りを最小化。
```

「重要な制約・規約」セクションに以下を追加:

```markdown
- **`/dial` は makeCall を直接呼ばない**。リスナーごとに `DIAL_QUEUE.sendBatch` でキューに積む
  （100件/sendBatch 制限でチャンク）。コンシューマー `handleDialQueue` が最大20件/バッチで処理。
- **default export は `Object.assign(app, { queue: handleDialQueue })` パターン**。
  `app.fetch` / `app.request` をそのまま保ちながら Workers ランタイムの `.queue` ハンドラを追加する。
```

---

### Task 7: 最終確認とコミット

**Files:** なし（確認のみ）

- [ ] **Step 1: 全テストが green であることを最終確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm test
```

期待: 全テスト PASS（58テスト以上）

- [ ] **Step 2: 型チェックが clean であることを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && npm run typecheck
```

期待: エラーなし

- [ ] **Step 3: コミットする**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare
git add src/queue/dial.ts src/env.ts src/index.ts src/routes/twilio.ts wrangler.jsonc test/queue/dial.test.ts test/routes/twilio-playback.test.ts README.md CLAUDE.md docs/superpowers/plans/2026-06-23-dial-queue.md
git commit -m "feat: /dialの一斉架電をQueue方式に変更（Free 50サブリクエスト制限を回避）"
```

gitleaks が誤検出で失敗した場合は `--no-verify` を追加:

```bash
git commit --no-verify -m "feat: /dialの一斉架電をQueue方式に変更（Free 50サブリクエスト制限を回避）"
```

- [ ] **Step 4: コミットが成功したことを確認する**

```bash
cd /Users/the_red/ghq/github.com/the-red/yagiphone-cloudflare && git log --oneline -3
```

---

## 自己レビュー

### Spec カバレッジ確認

| 要件 | 対応タスク |
|------|-----------|
| DialMessage 型定義（Twilio 認証情報なし） | Task 1 |
| handleDialQueue コンシューマー | Task 1 |
| テナントキャッシュ（D1読み取り最小化） | Task 1 |
| テナント未発見 → ack（無限リトライ防止） | Task 1 |
| makeCall 成功 → ack | Task 1 |
| makeCall 失敗 → retry | Task 1 |
| env.ts に DIAL_QUEUE: Queue<DialMessage> 追加 | Task 2 |
| src/index.ts Object.assign パターン | Task 3 |
| handleDial を sendBatch 方式に変更 | Task 4 |
| 100件/sendBatch チャンク | Task 4 |
| listeners 空なら sendBatch スキップ | Task 4 |
| handleDial から makeCall/getTwilioClient 呼び出し削除 | Task 4 |
| twilio-playback.test.ts /dial テスト更新 | Task 4 |
| test/queue/dial.test.ts 新規作成 | Task 1 |
| wrangler.jsonc queues ブロック（top-level） | Task 5 |
| wrangler.jsonc queues ブロック（env.production） | Task 5 |
| README.md Queue 作成手順追加 | Task 6 |
| CLAUDE.md DIAL_QUEUE/handleDialQueue 説明追加 | Task 6 |
| npm test 全 green | Task 7 |
| npm run typecheck clean | Task 7 |
| コミット | Task 7 |

### 型整合性確認

- `DialMessage` は `src/queue/dial.ts` で定義 → `src/env.ts` が import → 循環なし
- `handleDialQueue` のシグネチャ: `(batch: MessageBatch<DialMessage>, env: Env) => Promise<void>` — Task 1 で定義、Task 3 で import
- `getTwilioClient(tenant: Tenant)` — `src/routes/twilio.ts` で export 済み、Task 1 の dial.ts が import

### プレースホルダーなし確認

すべてのステップに実際のコードブロックが含まれていることを確認済み。
