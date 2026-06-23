# yagiphone Cloudflare版 設計書

作成日: 2026-06-23
ステータス: 承認済み（設計）

## 1. 目的とスコープ

AWS版 yagiphone（`/Users/the_red/ghq/github.com/the-red/yagiphone`、S3 / CloudFront / Lambda(Go) /
DynamoDB / Cognito / API Gateway 構成のマルチテナント型 Twilio IVR SaaS）を、Cloudflareスタックで
再構築する。本リポジトリ（`yagiphone-cloudflare`）で新規開発し、AWS版コードは移植元として参照する。

アプリの機能: 自治会向け電話連絡網。Twilioで着信/発信し、IVR（音声メニュー）で録音・再生・一斉架電を
行う。管理画面（Web）で名簿（recorder/listener）と録音・利用実績を管理。テナント（自治会）ごとに
Twilio認証情報を持つマルチテナント構成。

### 確定方針
- バックエンド: **TypeScript + Hono**（Workers ネイティブ実行）
- 認証: **Cloudflare Access**（Amplify撤去）
- フロント配信: **Worker に同居（Static Assets）**
- データストア: **D1（SQLite）**
- Twilio認証情報: **D1の `tenants` に保持**（AWS版踏襲。将来 Secrets Store へ分離可）
- ドメイン: **未定**。開発は `*.workers.dev` の仮URLで進め、カスタムドメイン割当後にAccessを有効化。

## 2. 全体アーキテクチャ

単一Workerに集約。Honoが全リクエストを捌き、APIに該当しないパスはStatic Assetsへフォールバックする。

```
Cloudflare → 1 Worker (Hono)
  ├─ env.ASSETS フォールバック … Next.js export(web/out) 配信（SPA）
  ├─ /health, /main, /router, /record, /play, /replay, /dial, /hangup
  │     … Twilio署名検証ミドルウェア → TwiML応答（Accessは掛けない）
  └─ /admin/*  … Access JWT検証ミドルウェア → 管理API
        ├─ D1: tenants / contacts
        └─ fetch() → Twilio REST API（MakeCall / ListRecordings / ListUsageRecords / GetCallFrom）
```

AWS版の5要素（API Gateway + Lambda + S3 + CloudFront + Cognito）→
Cloudflare版は **Worker + D1 + Access の3要素** に縮約される。

## 3. 認証（Cloudflare Access）

- Cloudflare側で **Accessアプリケーション** を2系統設定する:
  1. Web UI パス全般
  2. `/admin/*`
  - **Twilioのwebhookパス（/main, /router, /record, /play, /replay, /dial, /hangup, /health）は
    Accessから除外（bypass）** する。Twilioは署名検証で守る。
- ユーザーはCloudflareのログイン画面で認証 → `CF_Authorization` cookie を取得。
- SPAが同一オリジンの `/admin/*` を叩くと cookie が自動付与されるため、**フロントから Bearer トークン
  処理・Amplify を完全撤去** できる。
- Workerは多層防御として `Cf-Access-Jwt-Assertion` ヘッダを検証する。公開鍵は
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`（またはゾーンの `/cdn-cgi/access/certs`）
  から取得し、`aud`（Access Application Audience tag）と署名を検証。検証済みユーザーのメールを取得。
- **ローカル/初期開発**: `*.workers.dev` ではAccessが使えないため、Access検証ミドルウェアは
  環境変数（例 `ACCESS_ENABLED`）でスキップ可能にし、ダミーユーザーで開発する。カスタムドメイン
  割当後に有効化する。

## 4. データモデル（D1 / SQLite）

AWS版のDynamoDBスキーマを正規化して移植する。

```sql
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

CREATE TABLE contacts (
  tenant_id    TEXT NOT NULL,
  contact_key  TEXT NOT NULL,           -- "recorder#<電話番号>" / "listener#<電話番号>"
  name         TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  contact_type TEXT NOT NULL,           -- 'recorder' | 'listener'
  PRIMARY KEY (tenant_id, contact_key)
);
CREATE INDEX idx_contacts_tenant_type ON contacts(tenant_id, contact_type);
```

### アクセスパターン対応
| AWS版（DynamoDB） | Cloudflare版（D1 / SQL） |
|---|---|
| GetTenant（PK） | `SELECT ... WHERE tenant_id=?` |
| GetTenantByCallerId（全Scan・非効率） | `SELECT ... WHERE twilio_caller_id=?`（インデックス利用で効率化） |
| FindContact（PK+SK） | `SELECT ... WHERE tenant_id=? AND contact_key=?` |
| ListRecorders / ListListeners（begins_with） | `WHERE tenant_id=? AND contact_type=?`（インデックス利用） |
| ListAllContacts（PK） | `WHERE tenant_id=?` |
| CreateContact（Upsert） | `INSERT ... ON CONFLICT(tenant_id, contact_key) DO UPDATE` |
| DeleteContact | `DELETE WHERE tenant_id=? AND contact_key=?` |

## 5. コンポーネント構成

```
src/
  index.ts                        Honoアプリ・ルート登録・ASSETSフォールバック
  routes/twilio.ts                着信/IVR/録音/再生/架電ハンドラ
  routes/admin.ts                 contacts CRUD / recordings / usage
  middleware/twilioSignature.ts   X-Twilio-Signature 検証
  middleware/accessJwt.ts         Cf-Access-Jwt-Assertion 検証
  twiml/index.ts                  TwiML文字列ビルダ（ja-JP / Polly.Mizuki）
  twilio/client.ts                fetchベース Twilio RESTクライアント（テナント別）
  db/tenants.ts                   tenants D1クエリ
  db/contacts.ts                  contacts D1クエリ
web/                              Next.js（静的export元、Amplify撤去）
migrations/                       D1マイグレーション + シード
wrangler.jsonc                    Worker + D1 + assets + 環境(dev/prod)設定
package.json
```

### ルート一覧（移植対象）

Twilio Webhook（Access除外・署名検証あり）
| パス | メソッド | 役割 |
|---|---|---|
| `/health` | GET | ヘルスチェック |
| `/main` | GET/POST | 着信処理・発信者認証・IVRメニュー表示 |
| `/router` | POST | DTMF入力処理（1=最新再生, 3=録音） |
| `/dial` | GET | 一斉架電（Twilio MakeCall） |
| `/play` | GET/POST | 指定録音の再生 |
| `/replay` | GET/POST | 最新録音の再生 |
| `/record` | GET/POST | 通話録音（TwiML Record） |
| `/hangup` | POST | 通話終了 |

管理API（Access JWT検証あり）
| パス | メソッド | 役割 |
|---|---|---|
| `/admin/{tenantId}/contacts` | GET/POST | 名簿一覧・作成 |
| `/admin/{tenantId}/contacts/{contactKey}` | DELETE | 名簿削除 |
| `/admin/{tenantId}/recordings` | GET | 録音一覧（Twilio REST APIから取得） |
| `/admin/{tenantId}/usage` | GET | 利用実績（Twilio REST APIから取得） |

### Twilioクライアント
- `fetch` ベースの軽量クライアント。テナントごとの `account_sid` / `auth_token` で Basic 認証。
- メソッド: `makeCall(to, from, callUrl)`, `listRecordings(limit)`, `listUsageRecords(start, end)`,
  `getCallFrom(callSid)`, `recordingUrl(uri)`。
- AWS版のように起動時に全テナント分を構築せず、**リクエスト時にテナントを解決して都度生成**する
  （Workersのisolateモデルに適合）。

### TwiML
- 言語 `ja-JP`、音声 `Polly.Mizuki`。
- ビルダ: `<Say> <Gather> <Record> <Play> <Redirect> <Reject> <Hangup> <Pause>`。
- 文字列生成のみ（外部依存なし）→ 単体テスト容易。

## 6. エラーハンドリング

- Twilio webhook: 署名不正 → 403。テナント未解決 → TwiMLで `<Reject>`。
- 管理API: Access JWT不正/欠如 → 401。リソース無し → 404。バリデーション失敗 → 400。
- Twilio REST API失敗 → 502相当のエラー応答 + ログ出力。

## 7. テスト

- Vitest + `@cloudflare/vitest-pool-workers`（Miniflareで D1 / Worker をローカル実行）。
- 単体: TwiMLビルダ、D1クエリ（tenants/contacts）、署名検証・JWT検証ロジック。
- 統合: 各ルートをWorker経由でリクエストし、TwiML/JSON応答とD1状態を検証。
- Twilio REST APIはモック（fetchスタブ）。

## 8. デプロイ / 環境

- `wrangler` で dev / prod 環境を分離（`wrangler.jsonc` の env 設定、D1バインディングを環境別に）。
- 初期開発は `*.workers.dev` 仮URL。Access無効（ダミーユーザー）。
- カスタムドメイン確定後: ルート割当 + Accessアプリ設定 + Access検証有効化。
- DNSはCloudflare管理済み。

## 9. 移行ステップ（実装計画の元）

1. 足場: `wrangler init`、`wrangler.jsonc`（D1 / assets / 環境）、Hono導入、Vitest設定。
2. D1スキーマ + マイグレーション + 移植元データのシード。
3. TwiMLビルダ + D1クエリ層（単体テスト付き）。
4. Twilioクライアント（fetchベース、モックテスト）。
5. PoC: `/main`（着信→IVRメニュー）を署名検証込みで実装・テスト。
6. 残りのTwilio webhook群を移植（/router, /record, /replay, /play, /dial, /hangup, /health）。
7. 管理API（contacts CRUD / recordings / usage）+ Access JWT検証ミドルウェア。
8. フロント: Next.jsをStatic Assetsで配信、Amplify撤去、Bearer→cookie方式へ。
9. dev環境デプロイ → カスタムドメイン + Access有効化 → prod。

## 10. 参照

移植元リポジトリ: `/Users/the_red/ghq/github.com/the-red/yagiphone`
- バックエンド: `packages/functions/`（cmd/api/main.go, internal/handler/, internal/store/dynamo.go,
  internal/twilio/client.go, internal/handler/twiml.go）
- インフラ: `packages/infra/lib/yagiphone-stack.ts`, `cert-stack.ts`
- フロント: `packages/web/`（src/lib/auth.ts, src/lib/api.ts, src/app/layout.tsx）
