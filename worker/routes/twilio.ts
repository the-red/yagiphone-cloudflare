import { Hono } from 'hono';
import type { Env } from '../env';
import { TwiML } from '../twiml';
import { findContact, findRecorder, listListeners } from '../db/contacts';
import {
  parseParams, twimlResponse, errorTwiml, resolveTenantByTo, assertTwilioSignature, type Ctx,
} from './helpers';
import type { Tenant } from '../db/types';
import { TwilioClient, recordingUrl } from '../twilio/client';
import { getTenant } from '../db/tenants';

export const twilioRoutes = new Hono<{ Bindings: Env }>();

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

  const twiml = new TwiML().gather('/twilio/router', 1, (g) => {
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
    twiml.redirect('/twilio/replay');
  } else if (digits === '3') {
    const recorder = await findRecorder(c.env.DB, tenant.tenantId, from);
    if (recorder) twiml.redirect('/twilio/record');
    else { twiml.say('その操作は許可されていません。'); twiml.redirect('/twilio/main'); }
  } else {
    twiml.say('入力が正しくありません。'); twiml.redirect('/twilio/main');
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
  const callbackUrl = `/twilio/dial?Caller=${encodeURIComponent(from)}&TenantID=${encodeURIComponent(tenant.tenantId)}`;

  const twiml = new TwiML()
    .say(`録音を開始します。このメッセージは${listeners.length}人に送信されます。発信音の後にメッセージを録音してください。終了したら電話を切ってください。`)
    .record('/twilio/hangup', callbackUrl, maxLength);
  return twimlResponse(c, twiml);
}

// /hangup は <Record action="/twilio/hangup"> のアクションコールバック。
// 静的な <Hangup> のみを返し、テナントデータも副作用も持たないため、
// 署名検証・テナント解決のコンテキストを必要としない（意図的にバイパス）。
function handleHangup(c: Ctx) {
  return twimlResponse(c, new TwiML().hangup());
}

twilioRoutes.get('/main', handleMain);
twilioRoutes.post('/main', handleMain);
twilioRoutes.post('/router', handleRouter);
twilioRoutes.get('/record', handleRecord);
twilioRoutes.post('/record', handleRecord);
twilioRoutes.post('/hangup', handleHangup);

async function handleReplay(c: Ctx) {
  const params = await parseParams(c);
  const tenant = await resolveTenantByTo(c, params);
  if (!tenant) return errorTwiml(c);
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  const client = getTwilioClient(tenant);
  // listRecordings は Twilio アカウント単位で全録音を返す。クライアントはテナント自身の
  // sid/token から生成されるため、「1 テナント = 1 Twilio アカウント」モデルに依存している。
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
  // Fix 2: テナントが確定した後、makeCall前に署名検証
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  let recorderName = '不明';
  // Fix 3: DB エラーが発生しても応答を壊さないよう catch でフォールバック
  const contact = await findRecorder(c.env.DB, tenantId, recorder).catch(() => null);
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
  // テナントが確定した後、enqueue 前に署名検証
  if (!(await assertTwilioSignature(c, params, tenant.twilioAuthToken))) return c.text('forbidden', 403);

  const listeners = await listListeners(c.env.DB, tenantId);

  if (listeners.length > 0) {
    const playUrl = `https://${tenant.domain}/twilio/play?Recorder=${encodeURIComponent(caller)}&RecordingUrl=${encodeURIComponent(recUrl)}&TenantID=${encodeURIComponent(tenantId)}`;

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

twilioRoutes.get('/replay', handleReplay);
twilioRoutes.post('/replay', handleReplay);
// Fix 4: Go版原典に合わせ /play は GET のみ
twilioRoutes.get('/play', handlePlay);
twilioRoutes.get('/dial', handleDial);
