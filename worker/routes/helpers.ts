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
