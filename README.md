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
  ├─ /main /router /record /hangup /replay /play /dial
  │     … Twilio署名検証ミドルウェア → TwiML応答（無認可）
  └─ /admin/:tenantId/{contacts,recordings,usage}
        … Cloudflare Access JWT検証ミドルウェア → 管理API
             ├─ D1（tenants / contacts テーブル）
             └─ fetch() → Twilio REST API
```

- **Worker + Hono**: ルーティング・ミドルウェア・ハンドラ（`src/`）
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

ローカル開発では全て既定値（無効）のまま動作する。
本番有効化は後述の「カスタムドメイン + Access 有効化」を参照。

---

## デプロイ手順（ユーザーが実行）

> **以下のコマンドはユーザー自身の Cloudflare アカウントで実行してください。**

### 1. D1 データベース作成

```bash
npx wrangler d1 create yagiphone
```

出力された `database_id` を `wrangler.jsonc` の以下の箇所に記入する:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "yagiphone",
    "database_id": "ここに貼り付ける",   // <-- wrangler d1 create の出力値
    "migrations_dir": "migrations"
  }
]
```

### 2. リモートマイグレーション実行

```bash
npm run migrate:remote
```

### 3. フロントエンドビルド

```bash
cd web && npm run build && cd ..
```

### 4. デプロイ

```bash
npx wrangler deploy
```

成功すると `https://yagiphone.<subdomain>.workers.dev` が発行される。

### 5. 動作確認

```
GET https://yagiphone.<subdomain>.workers.dev/health
→ {"status":"ok"}
```

---

## データ投入（シード）

テナント情報（Twilio 認証情報を含む）は **`seed.sql`** に INSERT 文として記述し、
以下のコマンドで投入する:

```bash
wrangler d1 execute yagiphone --remote --file=seed.sql
```

> **`seed.sql` は Twilio 認証情報を含むため絶対にコミットしないこと。**
> `.gitignore` に追加済み。

---

## カスタムドメイン + Cloudflare Access 有効化（将来・ドメイン確定後）

1. `wrangler.jsonc` に `routes`（カスタムドメイン）を追加して再デプロイ
2. Cloudflare Zero Trust で Access アプリケーションを作成
   - Web UI 全体（`/`）と管理 API（`/admin/*`）を保護
   - Twilio Webhook パス（`/main` `/router` `/record` `/play` `/replay` `/dial` `/hangup` `/health`）は **Bypass** ポリシーに設定
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
  src/
    index.ts          … Worker エントリポイント（Hono アプリ）
    env.ts            … 環境変数型定義
    routes/
      twilio/         … Twilio Webhook ハンドラ（/main /router /record /hangup /replay /play /dial）
      admin/          … 管理 API ハンドラ（/admin/:tenantId/...）
    auth/             … Cloudflare Access JWT 検証ミドルウェア
    db/               … D1 アクセス層（tenants / contacts クエリ）
    twiml/            … TwiML 生成ユーティリティ
    twilio/           … Twilio REST クライアント（fetch ベース）
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
