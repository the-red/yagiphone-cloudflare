# yagiphone Cloudflare移行 — 引き継ぎドキュメント

最終更新: 2026-06-23

このドキュメントは、AWS版 yagiphone（`/Users/the_red/ghq/github.com/the-red/yagiphone`）を
**Cloudflare前提で再構築**するための検討結果と作業計画をまとめたもの。別セッションでもこれを読めば続行できる。

---

## 0. ゴールと方針

- AWS版 yagiphone（S3 / CloudFront / Lambda(Go) / DynamoDB / Cognito / API Gateway 構成の
  **マルチテナント型 Twilio IVR SaaS**）を、Cloudflareスタックで作り直す。
- **リポジトリは完全分離**。本リポジトリ（`yagiphone-cloudflare`）で新規開発する。
  AWS版のコードは移植元として参照するのみ。
- DNSは既にCloudflare管理（AWS版で移行済み）。

### アプリの機能ざっくり
自治会向け電話連絡網。Twilioで着信/発信し、IVR（音声メニュー）で録音・再生・一斉架電を行う。
管理画面（Web）で名簿（recorder/listener）と録音・利用実績を管理。テナント（自治会）ごとに
Twilio認証情報を持つマルチテナント構成。

---

## 1. 移植元（AWS版）アーキテクチャ要点

参照元リポジトリ: `/Users/the_red/ghq/github.com/the-red/yagiphone`

### モノレポ構成
- `packages/infra/` … AWS CDK (TypeScript)
- `packages/functions/` … Lambda バックエンド (Go 1.25, chi router, aws-lambda-go-api-proxy)
- `packages/web/` … Next.js 15 (App Router, `output: 'export'` の静的サイト) + AWS Amplify認証

### バックエンドのルート構成（移植対象）
Goの `chi` ルーター。`aws-lambda-go-api-proxy/chi` でAPI Gateway v2 proxyをchiに変換。

**Twilio Webhook（無認可）**
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

**管理API（Cognito JWT認可）**
| パス | メソッド | 役割 |
|---|---|---|
| `/admin/{tenantId}/contacts` | GET/POST | 名簿一覧・作成 |
| `/admin/{tenantId}/contacts/{contactKey}` | DELETE | 名簿削除 |
| `/admin/{tenantId}/recordings` | GET | 録音一覧（Twilio REST APIから取得） |
| `/admin/{tenantId}/usage` | GET | 利用実績（Twilio REST APIから取得） |

### データモデル（DynamoDB → 移植対象）
**tenants**（PK: `tenantId`）
```
tenantId, name(自治会名), twilioAccountSid, twilioAuthToken,
twilioCallerId, maxRecordingLength(秒), domain
```
**contacts**（PK: `tenantId`, SK: `contactKey`）
```
tenantId, contactKey("recorder#電話番号" or "listener#電話番号"),
name, phoneNumber, contactType("recorder"|"listener")
```
アクセスパターン:
- tenant 1件取得（PK）／ callerId からテナント検索（現状は全Scan・非効率）
- contact 1件取得（PK+SK）
- recorder/listener 一覧（PK + `begins_with("recorder#" / "listener#")`）
- 全contact一覧（PK）／ 作成（Upsert）／ 削除

### Twilio連携
- 認証情報は **tenantsテーブルに保存**。起動時に全テナントを読み Twilioクライアントを構築。
- 主なREST API: `MakeCall`(発信), `ListRecordings`(録音一覧), `ListUsageRecords`(利用実績), `GetCallFrom`(発信者取得)。
- TwiML生成: `ja-JP`, 音声 `Polly.Mizuki`。`<Say><Gather><Record><Play><Redirect><Reject><Hangup><Pause>`。
- **現状 Twilio署名検証は未実装**（Caller IDからテナント推測のみ）。移行時に署名検証を入れるべき。

### フロントエンド
- Next.js 15 静的エクスポート。AWS Amplify + `<Authenticator hideSignUp>`（管理者が手動でユーザー作成、セルフサインアップ無効）。
- API呼び出しは Cognito ID Token を `Authorization: Bearer` で付与。
- ページ: `/`（テナント選択）, `/[tenantId]/`（ダッシュボード）, `/[tenantId]/contacts|recordings|usage`。

### 環境
- dev: `yagiphone-dev.the-red.jp` / prod: `yagiphone.the-red.jp`
- DNSはCloudflare管理済み。

---

## 2. ターゲット（Cloudflare版）アーキテクチャ

```
Cloudflare DNS → 単一Worker（Honoルーター）
  ├─ /*  静的アセット（Static Assets binding）… Next.js export を配信
  ├─ /main, /router, /record, /play, /replay, /dial, /hangup
  │     … Twilio署名検証 → TwiML応答（無認可）
  └─ /admin/*  … Cloudflare Access保護 + Worker側でAccess JWT検証 → 管理API
       ├─ D1: tenants / contacts
       ├─ D1 or Secrets Store: Twilioテナント認証情報
       └─ fetch() → Twilio REST API（発信・録音・利用実績）
```

AWS版の5要素（API Gateway + Lambda + S3 + CloudFront + Cognito）→
Cloudflare版は **Worker + D1 + Access の3要素** に縮約される。

### サービス対応表
| AWS | Cloudflare | 難易度 | メモ |
|---|---|---|---|
| S3 + CloudFront | Workers Static Assets（or Pages） | easy | Next.js export をそのまま配信 |
| Lambda(Go/chi) + API GW | Workers + **Hono** | ★★ | **Go→TS書き換えが最大の作業** |
| DynamoDB tenants | D1（or KV） | easy | |
| DynamoDB contacts（PK+SK, begins_with） | D1（SQLite） | easy | `begins_with`→ SQL `LIKE`/インデックス |
| Cognito + Amplify | Cloudflare Access（Zero Trust） | ★★ | 内部管理画面なので相性◎。Amplify撤去可 |
| API GW JWTオーソライザ | Access JWT検証（`Cf-Access-Jwt-Assertion`） | easy | |
| ACM / Route53 | Cloudflare Managed SSL / DNS | done | |

---

## 3. 要決定の設計判断（3点）

### ① バックエンド Go → **TypeScript + Hono に書き換え**（推奨）
- WorkersはV8 isolateでネイティブGoバイナリを実行不可。JS/TS/WASMのみ。
- chi と Hono はAPIが酷似。ルート構造とTwiML文字列生成はほぼそのまま移植可能。ハンドラは十数本で軽量。
- TinyGo→WASM化は可能だがAWS SDK/net/http依存で茨の道。非推奨。
- **未決**: 本当にTS全面書き換えでよいか（ユーザー確認推奨）。

### ② 認証 Cognito → **Cloudflare Access**（推奨）
- 管理画面は `hideSignUp`（完全内部向け）= Accessの王道ユースケース。
- `/admin/*` にAccessポリシーを当て、Workerは付与されたJWTを検証するだけ。
- フロントから Amplify/Authenticator を**丸ごと削除可能**。50ユーザーまで無料。
- 代替: ログインUIを自前で持ちたいなら Auth0等の外部IdP連携も可。この規模ならAccessが最適。
- **未決**: Access採用でよいか。ログイン手段（Google / メールOTP 等）の希望。

### ③ データストア → **D1（SQLite）**（推奨）
- アクセスパターンが単純（PK / PK+begins_with）なのでD1にきれいに収まる。
- 代替: tenantsだけKV、という手もあるが、D1単一の方が一貫性・クエリ表現で有利。
- **未決**: D1で確定か。Twilio認証情報をD1に置くか Secrets Store に分けるか。

### ④ （補足）Twilio署名検証を新規実装
- AWS版では未実装。Webhookパスに `X-Twilio-Signature` 検証をWorkers側で入れる方針。

---

## 4. 想定モノレポ構成（提案・未確定）

AWS版と揃えるか、Cloudflare流に寄せるかは要検討。たたき台:
```
yagiphone-cloudflare/
  src/                 … Worker本体（Hono）
    routes/twilio/     … /main, /router, ... ハンドラ
    routes/admin/      … 管理API
    twiml/             … TwiML生成
    db/                … D1アクセス（schema.sql, queries）
    twilio/            … Twilio RESTクライアント（fetchベース）
  web/                 … Next.js（できれば静的export流用、認証だけAccessへ）
  migrations/          … D1マイグレーション
  wrangler.jsonc       … Worker + D1 + Static Assets + 環境(dev/prod) 設定
```
※ webをWorkerと同居させるか別Pagesにするかは①②確定後に決める。

---

## 5. 次のステップ（推奨順）

1. **設計確定**: 上記 ①②③ をユーザーと合意（brainstormingスキル推奨）。
2. **足場作り**: `wrangler init`、`wrangler.jsonc`（D1 / Static Assets / dev・prod環境）、Hono導入。
3. **D1スキーマ**: tenants / contacts のDDLとマイグレーション、移植元データのシード。
4. **PoC**: `/main`（着信→IVRメニューのTwiML応答）をWorkers+Honoで動かす最小実装。Twilio署名検証込み。
5. **Twilio Webhook群**を順次移植（/router, /record, /replay, /play, /dial, /hangup）。
6. **管理API + Access**: `/admin/*` をAccessで保護、JWT検証、contacts CRUD、recordings/usage中継。
7. **フロント**: Next.jsをStatic Assetsで配信、Amplmy撤去しAccessへ。
8. **dev環境デプロイ → prod**。DNSはCloudflare管理済みなのでルーティング設定のみ。

---

## 6. オープンクエスチョン（ユーザー確認待ち）

- [ ] バックエンドはTypeScript+Honoへ全面書き換えでよいか？
- [ ] 認証はCloudflare Accessでよいか？ ログイン手段の希望は？
- [ ] データストアはD1で確定か？ Twilio認証情報の置き場所（D1 / Secrets Store）。
- [ ] フロントはWorker同居 / 別Pages どちらにするか。
- [ ] モノレポ構成（AWS版踏襲 vs Cloudflare流）。
- [ ] dev/prod のドメインは新規に切るか（例: `cf.yagiphone-dev.the-red.jp` 等）、既存と差し替えるか。

---

## 7. 参照

- 移植元リポジトリ: `/Users/the_red/ghq/github.com/the-red/yagiphone`
  - バックエンド: `packages/functions/`（cmd/api/main.go, internal/handler/, internal/store/dynamo.go, internal/twilio/client.go, internal/handler/twiml.go）
  - インフラ: `packages/infra/lib/yagiphone-stack.ts`, `cert-stack.ts`
  - フロント: `packages/web/`（src/lib/auth.ts, src/lib/api.ts, src/app/layout.tsx）
- Cloudflare技術メモ（Workersの特性）:
  - V8 isolate実行（コンテナ/VMではない）。コールドスタート <1ms、世界300拠点で実行。
  - 言語はJS/TS/WASMのみ（→Go書き換えの理由）。メモリ128MB固定。
  - 課金はCPU時間ベース。`fetch()`の外部API待ち時間は課金対象外（IVRと相性良）。
  - CPU時間上限: 無料10ms / 有料30秒(既定)〜5分(上限)。重い計算には不向き。
