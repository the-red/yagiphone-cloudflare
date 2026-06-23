# CLAUDE.md

このリポジトリで作業する際のガイド。詳細な背景は `docs/superpowers/`（設計書・実装計画）と `README.md` を参照。

## プロジェクト概要

**yagiphone** — マルチテナント型 Twilio IVR（自治会向け電話連絡網）。
Twilio で着信/発信し、IVR 音声メニューで録音・再生・一斉架電を行う。管理画面で名簿
（recorder/listener）と録音・利用実績を管理。テナント（自治会）ごとに Twilio 認証情報を持つ。

AWS 版（S3 / CloudFront / Lambda(Go) / DynamoDB / Cognito / API Gateway）を
**単一の Cloudflare Worker** に再構築したもの。移植元は別リポジトリ `the-red/yagiphone`。

## 技術スタック

- **TypeScript + ESM**（`"type": "module"`）
- **Hono** — Worker のルーター
- **Cloudflare Workers**（V8 isolate）— ランタイム
- **D1**（SQLite）— データストア（binding 名 `DB`）
- **Cloudflare Queues**（binding 名 `DIAL_QUEUE`）— `/dial` の一斉架電Fan-outに使用
- **Cloudflare Access** — `/admin/*` の認証（JWT を Worker 側で検証）
- **Static Assets**（binding 名 `ASSETS`）— `web/out/`（Next.js 静的 export）を SPA 配信
- **Vitest + @cloudflare/vitest-pool-workers** — テスト（実 D1 を Miniflare で実行）

## よく使うコマンド

```bash
npm test            # Vitest 全実行（54テスト）
npm run typecheck   # tsc --noEmit
npm run migrate:local   # ローカル D1 にマイグレーション適用
npx wrangler dev    # ローカル開発サーバー（http://localhost:8787）

cd web && npm run build   # フロントエンドを web/out/ に静的ビルド
```

テストは「失敗を先に確認 → 実装 → 成功確認」の TDD で書く。1テストに絞るなら
`npm test -- <ファイル名の一部>`（例: `npm test -- twilio-ivr`）。

## ディレクトリ構成

```
worker/               Worker 本体（wrangler.jsonc の main = worker/index.ts）
  index.ts            Hono アプリ。マウント順が重要:
                      /health → twilioRoutes → use('/admin/*', accessMiddleware)
                      → adminRoutes → app.all('*') で ASSETS フォールバック（必ず最後）
  env.ts              Env 型（DB, ASSETS, ACCESS_*, TWILIO_VALIDATE, DIAL_QUEUE）
  db/types.ts         Tenant / Contact 型と snake_case 行 → camelCase 変換（toTenant/toContact）
  db/tenants.ts       テナントクエリ（getTenant, getTenantByCallerId）
  db/contacts.ts      名簿クエリ（findContact/findRecorder/list*/createContact[upsert]/deleteContact）
  twiml/index.ts      TwiML(XML) ビルダ（手組み・エスケープ付き）
  twilio/client.ts    Twilio REST クライアント（fetch ベース。テスト差し替え用に fetchImpl 注入可）
  twilio/signature.ts X-Twilio-Signature 検証（HMAC-SHA1 / Web Crypto）
  routes/helpers.ts   parseParams / テナント解決 / 署名ガード / TwiML 応答
  routes/twilio.ts    Twilio Webhook ハンドラ。Twilio クライアントは setTwilioClientFactory で差し替え可
  routes/admin.ts     管理 API（contacts CRUD / recordings / usage）
  auth/access.ts      Cloudflare Access JWT 検証ミドルウェア（RS256 / JWKS）
  queue/dial.ts       DialMessage 型 + handleDialQueue コンシューマー。
                      バッチ内でテナントをキャッシュして D1 読み取りを最小化。
migrations/0001_init.sql   D1 スキーマ（tenants / contacts）
web/                  Next.js 静的フロントエンド（→ web/out/）
test/                 Vitest（test/helpers/db.ts に applyMigrations/seedTenant/seedContact）
```

## 重要な制約・規約

- **Workers ランタイム = Web API のみ**。Node.js 専用 API・ネイティブ依存は使わない
  （`fetch` / `crypto.subtle` / `btoa` / `atob` / `URLSearchParams` / `TextEncoder` 等を使う。
  `Buffer` や `node:crypto` は不可）。
- **`nodejs_compat` は本番 `wrangler.jsonc` に入れない**。テストハーネス
  （vitest-pool-workers）が必要とするため `vitest.config.ts` の miniflare 側にのみ付与している。
- **TwiML** は手組み。言語 `ja-JP`、音声 `Polly.Mizuki`。チャーデータ・属性値は `& < > " '` をエスケープ。
- **認証ゲートは環境変数で制御**（ローカルは無効）:
  - `ACCESS_ENABLED=true` で `/admin/*` の Access JWT 検証が有効（`false` ならダミーユーザー `dev@local` で通過）。
  - `TWILIO_VALIDATE=true` で Twilio Webhook の署名検証が有効。
  - 本番有効化は `wrangler.jsonc` の `env.production`（両ゲート `"true"`）で行い `wrangler deploy --env production`。
- **`/dial` は makeCall を直接呼ばない**。リスナーごとに `DIAL_QUEUE.sendBatch` でキューに積む
  （100件/sendBatch 制限でチャンク）。コンシューマー `handleDialQueue` が最大20件/バッチで処理。
- **default export は `Object.assign(app, { queue: handleDialQueue })` パターン**。
  `app.fetch` / `app.request` をそのまま保ちながら Workers ランタイムの `.queue` ハンドラを追加する。
- **新しいクエリ/ルートを足すときは既存層を import**（型・クエリ・ヘルパを再定義しない）。
- ファイルは単一責務・小さく保つ。

## マルチテナントの解決

- Twilio Webhook: リクエストの `To`（着信番号）→ `getTenantByCallerId` でテナント特定。
- 管理 API: パスパラメータ `:tenantId`。**認証はしているが、ユーザー→テナントの認可は無い**
  （Access ポリシーで単一の信頼運用者グループに限定する前提。複数テナントを自己管理させる場合は要追加実装）。
- Twilio 認証情報は `tenants` テーブルに保持。リクエスト時にテナントを解決して都度クライアント生成。

## テストの書き方

- `cloudflare:test` の `env`（`env.DB` 等）と `test/helpers/db.ts` の
  `applyMigrations()` / `seedTenant()` / `seedContact()` を使い、**実 D1** で検証（モックにしない）。
- 環境変数を切り替えるテストは `app.request(path, init, { ...env, TWILIO_VALIDATE: 'true' })` の
  第3引数で env を上書き（Access の 401 や署名 403 の検証）。
- Twilio REST は `setTwilioClientFactory()`、Twilio クライアント内部は `fetchImpl` 注入でモック。
- 正当な署名のテストは `worker/twilio/signature.ts` の `computeSignature` で署名を生成して付与する。

## デプロイ（ユーザー作業）

実デプロイは Cloudflare アカウントが必要。手順は `README.md` 参照:
`wrangler d1 create yagiphone` → 出力 `database_id` を `wrangler.jsonc` に記入 →
`npm run migrate:remote` → `cd web && npm run build` → `npx wrangler deploy --env production`。
Twilio 認証情報を含む `seed.sql` は **コミット禁止**（`.gitignore` 済み）。

## 注意点（既知）

- gitleaks が `dev@local`（テスト用ダミー）等を誤検出することがある。誤検出なら `--no-verify` で再コミット。
- `.superpowers/` は SDD（subagent-driven-development）のスクラッチで gitignore 対象。
- Access JWKS キャッシュに TTL は無い（鍵ローテーションは Worker 再デプロイ/アイソレート再起動で反映）。
