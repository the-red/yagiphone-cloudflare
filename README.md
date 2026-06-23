# yagiphone-cloudflare

マルチテナント型 Twilio IVR（自治会向け電話連絡網）の Cloudflare Workers 実装。
AWS 版（S3 / CloudFront / Lambda(Go) / DynamoDB / Cognito）を
**Cloudflare Worker + Hono + D1 + Static Assets + Cloudflare Access** の構成で再構築したもの。

---

## アーキテクチャ

```
Cloudflare DNS → 単一Worker（Honoルーター）
  ├─ /*  静的アセット（Static Assets binding）… Next.js export（web/out/）を配信
  ├─ /health                … ヘルスチェック（GET）
  ├─ /twilio/*  （main router record hangup replay play dial）
  │     … Twilio Webhook。署名検証ミドルウェア → TwiML応答（Accessは /twilio/* をBypass）
  │     /twilio/dial はリスナーを Cloudflare Queue (yagiphone-dial) にエンキューし、
  │     同一Workerの queue() ハンドラが20件/バッチで makeCall する（Free 50サブリクエスト制限回避）
  └─ /admin/:tenantId/{contacts,recordings,usage}
        … Cloudflare Access JWT検証ミドルウェア → 管理API
             ├─ D1（tenants / contacts テーブル）
             └─ fetch() → Twilio REST API
```

- **Worker + Hono**: ルーティング・ミドルウェア・ハンドラ（`worker/`）
- **D1（SQLite）**: テナント情報・名簿。マイグレーションは `migrations/`
- **Static Assets binding**: `web/out/` を SPA モードで配信
- **Cloudflare Access**: `/admin/*` を保護。Worker 内で `Cf-Access-Jwt-Assertion` を検証

---

## セットアップ

### Worker 依存インストール

```bash
npm install
```

### フロントエンドビルド（web/out/ を生成）

```bash
cd web
npm install
npm run build
cd ..
```

---

## テスト・型チェック

```bash
npm test          # Vitest（51テスト）
npm run typecheck # tsc --noEmit
```

---

## ローカル開発

```bash
# D1 をローカル（.wrangler/state）に作成・マイグレーション
npm run migrate:local

# ローカル開発サーバー起動
npx wrangler dev
```

`http://localhost:8787/health` → `{"status":"ok"}` が返れば正常。

---

## 環境変数（wrangler.jsonc `vars`）

| 変数名 | 既定値 | 説明 |
|---|---|---|
| `ACCESS_ENABLED` | `"false"` | `"true"` にすると `/admin/*` の Cloudflare Access JWT 検証を有効化 |
| `ACCESS_TEAM_DOMAIN` | `""` | Cloudflare Zero Trust チームドメイン（例: `myteam.cloudflareaccess.com`）|
| `ACCESS_AUD` | `""` | Access Application の Audience（AUD）タグ |
| `TWILIO_VALIDATE` | `"false"` | `"true"` にすると Twilio Webhook 署名検証を有効化 |

ローカル開発と dev 環境では全て既定値（無効）。本番（`env.production`）は
`ACCESS_ENABLED` / `TWILIO_VALIDATE` を `"true"` に設定済み。

---

## デプロイ手順（ユーザーが実行）

> **以下のコマンドはユーザー自身の Cloudflare アカウントで実行してください。**

dev / prod の2環境を同一アカウントに別 Worker としてデプロイする。`wrangler.jsonc` の
top-level が **dev**（`yagiphone-dev`）、`env.production` が **prod**（`yagiphone`）。

| | dev | prod |
|---|---|---|
| Worker 名 | `yagiphone-dev` | `yagiphone` |
| D1 DB | `yagiphone-dev` | `yagiphone` |
| Queue | `yagiphone-dial-dev` | `yagiphone-dial` |
| 認証ゲート | 無効 | 有効 |
| デプロイ | `npm run deploy:dev` | `npm run deploy:prod` |
| マイグレーション | `npm run migrate:dev` | `npm run migrate:prod` |

### 1. リソース作成（初回のみ）

D1 データベースは作成済み（`database_id` は `wrangler.jsonc` に記入済み）。Queue を作成する:

```bash
npx wrangler queues create yagiphone-dial-dev   # dev
npx wrangler queues create yagiphone-dial       # prod
```

新しく D1 を作り直す場合は `npx wrangler d1 create <名前>` の出力 `database_id` を
`wrangler.jsonc` の該当環境に記入する（dev は top-level、prod は `env.production`）。

### 2. マイグレーション

```bash
npm run migrate:dev    # yagiphone-dev に適用
npm run migrate:prod   # yagiphone に適用
```

### 3. フロントエンドビルド

```bash
cd web && npm run build && cd ..
```

### 4. デプロイ

```bash
npm run deploy:dev     # → https://yagiphone-dev.<subdomain>.workers.dev
npm run deploy:prod    # → https://yagiphone.<subdomain>.workers.dev
```

### デプロイ時の注意

- **Twilio Webhook URL の完全一致**: Twilio コンソールで設定する Webhook URL は、Workers が受け取るリクエスト URL（スキーム・ホスト・パス）と**完全に一致**させること。末尾スラッシュの有無など些細な差異でも署名検証が失敗し、正規のリクエストが 403 で拒否される。dev/prod でテナントの Webhook URL を取り違えないこと。
- **JWKS キャッシュと鍵ローテーション**: Access JWKS のキャッシュは TTL を持たない。Worker の再デプロイまたはアイソレートの再起動により、Cloudflare Access の鍵ローテーションが自動的に反映される。
- **無料枠はアカウント共有**: Workers 100k req/日・D1・Queues などの無料枠は dev+prod 合計で効く。

### 5. 動作確認

```
GET https://yagiphone-dev.<subdomain>.workers.dev/health   # dev
GET https://yagiphone.<subdomain>.workers.dev/health       # prod
→ {"status":"ok"}
```

---

## データ投入（シード）

テナント情報（Twilio 認証情報を含む）は **`seed.sql`** に INSERT 文として記述し、
環境ごとに対象 D1 を指定して投入する:

```bash
wrangler d1 execute yagiphone-dev --remote --file=seed.sql                  # dev
wrangler d1 execute yagiphone --remote --env production --file=seed.sql     # prod
```

> **`seed.sql` は Twilio 認証情報を含むため絶対にコミットしないこと。**
> `.gitignore` に追加済み。dev と prod でテナント内容を分けたい場合は別ファイルにする。

---

## カスタムドメイン + Cloudflare Access 有効化（将来・ドメイン確定後）

1. `wrangler.jsonc` に `routes`（カスタムドメイン）を追加して再デプロイ
2. Cloudflare Zero Trust で Access アプリケーションを作成
   - Web UI 全体（`/`）と管理 API（`/admin/*`）を保護
   - Twilio Webhook は `/twilio/*` に集約済み。**`/twilio/*` を Bypass** ポリシーに設定（必要なら `/health` も）。残り（Web UI・`/admin/*`）は Allow で保護
3. Access Application の **Audience（AUD）タグ** と **チームドメイン** を取得
4. `wrangler.jsonc` `vars` を更新:
   ```jsonc
   "ACCESS_ENABLED": "true",
   "ACCESS_TEAM_DOMAIN": "<チームドメイン>",
   "ACCESS_AUD": "<AUDタグ>",
   "TWILIO_VALIDATE": "true"
   ```
5. `npx wrangler deploy` で再デプロイ
6. Twilio コンソールの各 Webhook URL をカスタムドメインへ更新

---

## ディレクトリ構成

```
yagiphone-cloudflare/
  worker/             … Worker 本体（wrangler.jsonc の main = worker/index.ts）
    index.ts          … エントリポイント（Hono アプリ + queue コンシューマー）
    env.ts            … 環境変数・バインディング型定義
    routes/twilio.ts  … Twilio Webhook ハンドラ（/twilio/* に集約: main router record hangup replay play dial）
    routes/admin.ts   … 管理 API ハンドラ（/admin/:tenantId/...）
    routes/helpers.ts … リクエスト共通ヘルパ
    auth/access.ts    … Cloudflare Access JWT 検証ミドルウェア
    db/               … D1 アクセス層（types / tenants / contacts）
    twiml/index.ts    … TwiML 生成ユーティリティ
    twilio/           … Twilio REST クライアント（client）+ 署名検証（signature）
    queue/dial.ts     … /twilio/dial 一斉架電のキューコンシューマー
  web/                … Next.js 静的フロントエンド（npm run build → out/）
  migrations/
    0001_init.sql     … D1 スキーマ（tenants / contacts テーブル）
  wrangler.jsonc      … Worker 設定（D1 / Static Assets / 環境変数）
  test/               … Vitest テスト
```

---

## 参照

- 移植元 AWS 版: `the-red/yagiphone` リポジトリ（S3 / CloudFront / Lambda(Go) / DynamoDB / Cognito 構成）
- 設計ドキュメント: `docs/superpowers/`
- 引き継ぎドキュメント: `HANDOFF.md`
