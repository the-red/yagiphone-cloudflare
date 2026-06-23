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
