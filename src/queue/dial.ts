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
