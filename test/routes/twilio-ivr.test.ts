import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../worker/index';
import { applyMigrations, seedTenant, seedContact } from '../helpers/db';

const TO = '+815000000001';
async function post(path: string, form: Record<string,string>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  }, env);
}

describe('Twilio IVR routes', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({ tenant_id: 'hosoiri', twilio_caller_id: TO, name: '細入', max_recording_length: 0 });
  });

  it('/main: 名簿外はReject', async () => {
    const res = await post('/main', { To: TO, From: '+819999' });
    expect(await res.text()).toContain('<Reject></Reject>');
  });

  it('/main: recorderには録音案内を含むGather', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    const res = await post('/main', { To: TO, From: '+8190' });
    const xml = await res.text();
    expect(xml).toContain('<Gather action="/router" numDigits="1">');
    expect(xml).toContain('録音する場合は3');
  });

  it('/main: listenerには再生案内のみ', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8191', contact_type: 'listener', name: '花子' });
    const res = await post('/main', { To: TO, From: '+8191' });
    const xml = await res.text();
    expect(xml).toContain('最新の録音を聞く場合は1');
    expect(xml).not.toContain('録音する場合は3');
  });

  it('/router: 1 は /replay へリダイレクト', async () => {
    const res = await post('/router', { To: TO, From: '+8191', Digits: '1' });
    expect(await res.text()).toContain('<Redirect>/replay</Redirect>');
  });

  it('/router: 3 は recorder なら /record', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    const res = await post('/router', { To: TO, From: '+8190', Digits: '3' });
    expect(await res.text()).toContain('<Redirect>/record</Redirect>');
  });

  it('/router: 3 は非recorderなら不許可メッセージ', async () => {
    const res = await post('/router', { To: TO, From: '+8191', Digits: '3' });
    const xml = await res.text();
    expect(xml).toContain('その操作は許可されていません');
    expect(xml).toContain('<Redirect>/main</Redirect>');
  });

  it('/record: 録音案内とRecordを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8192', contact_type: 'listener', name: 'L' });
    const res = await post('/record', { To: TO, From: '+8190' });
    const xml = await res.text();
    expect(xml).toContain('1人に送信されます');
    expect(xml).toContain('recordingStatusCallbackMethod="GET"');
    expect(xml).toContain('maxLength="50"');
  });

  it('/record: max_recording_length が0以外ならその値をmaxLengthに使う', async () => {
    const TO2 = '+815000000002';
    await seedTenant({ tenant_id: 'kamioka', twilio_caller_id: TO2, name: '神岡', max_recording_length: 120 });
    await seedContact({ tenant_id: 'kamioka', phone_number: '+8193', contact_type: 'listener', name: 'L2' });
    const res = await post('/record', { To: TO2, From: '+8190' });
    const xml = await res.text();
    expect(xml).toContain('1人に送信されます');
    expect(xml).toContain('maxLength="120"');
    expect(xml).not.toContain('maxLength="50"');
  });

  it('/hangup: Hangup', async () => {
    const res = await post('/hangup', {});
    expect(await res.text()).toContain('<Hangup></Hangup>');
  });
});
