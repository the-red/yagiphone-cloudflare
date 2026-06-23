import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { applyMigrations, seedTenant, seedContact } from '../helpers/db';
import { setTwilioClientFactory, formatRecordingDate } from '../../src/routes/twilio';
import { computeSignature } from '../../src/twilio/signature';

const TO = '+815000000001';

describe('playback/dial routes', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({ tenant_id: 'hosoiri', twilio_caller_id: TO, name: '細入', domain: 'h.example' });
  });

  it('formatRecordingDate: RFC1123Z を JST表記に', () => {
    expect(formatRecordingDate('Sun, 23 Jun 2024 00:30:00 +0000')).toBe('6月23日9時30分');
  });

  it('/replay: 録音なしは「録音がありません」', async () => {
    setTwilioClientFactory(() => ({ listRecordings: async () => [], getCallFrom: async () => '' }) as any);
    const res = await app.request(`/replay?To=${encodeURIComponent(TO)}`, {}, env);
    expect(await res.text()).toContain('録音がありません');
  });

  it('/replay: 最新録音を再生（録音者名付き）', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    setTwilioClientFactory(() => ({
      listRecordings: async () => [{ sid: 'RE1', callSid: 'CA1', duration: '5', dateCreated: 'Sun, 23 Jun 2024 00:30:00 +0000', uri: '/x.json' }],
      getCallFrom: async () => '+8190',
    }) as any);
    const res = await app.request(`/replay?To=${encodeURIComponent(TO)}`, {}, env);
    const xml = await res.text();
    expect(xml).toContain('太郎');
    expect(xml).toContain('6月23日9時30分');
    expect(xml).toContain('<Play>https://api.twilio.com/x</Play>');
  });

  it('/play: テナント名と録音者名・Playを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder', name: '太郎' });
    const url = `/play?TenantID=hosoiri&Recorder=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, env);
    const xml = await res.text();
    expect(xml).toContain('細入');
    expect(xml).toContain('太郎');
    expect(xml).toContain('<Play>https://x/a.mp3</Play>');
  });

  it('/dial: 各listenerをQueueにenqueueし空Responseを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8181', contact_type: 'listener', name: 'L1' });
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8182', contact_type: 'listener', name: 'L2' });
    const sent: any[] = [];
    const mockQueue = { sendBatch: async (msgs: any[]) => { sent.push(...msgs); }, send: async () => {} };
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, { ...env, DIAL_QUEUE: mockQueue } as any);
    // tenantId
    expect(sent.every((m) => m.body.tenantId === 'hosoiri')).toBe(true);
    // to はリスナーの電話番号
    expect(sent.map((m) => m.body.to).sort()).toEqual(['+8181', '+8182']);
    // playUrl にテナントの domain と Recorder/RecordingUrl/TenantID が含まれる
    expect(sent.every((m) =>
      m.body.playUrl.includes('https://h.example/play?Recorder=')
      && m.body.playUrl.includes(`RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`)
      && m.body.playUrl.includes('TenantID=hosoiri'),
    )).toBe(true);
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  // --- 署名検証テスト（TWILIO_VALIDATE='true' 時）---

  it('/dial: TWILIO_VALIDATE=true かつ署名なしで 403、enqueue されない', async () => {
    const sent: any[] = [];
    const mockQueue = { sendBatch: async (msgs: any[]) => { sent.push(...msgs); }, send: async () => {} };
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, { ...env, TWILIO_VALIDATE: 'true', DIAL_QUEUE: mockQueue } as any);
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('/dial: TWILIO_VALIDATE=true かつ正当な署名で 200、enqueue される', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8181', contact_type: 'listener', name: 'L1' });
    const sent: any[] = [];
    const mockQueue = { sendBatch: async (msgs: any[]) => { sent.push(...msgs); }, send: async () => {} };
    const path = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const fullUrl = `http://localhost${path}`;
    const sig = await computeSignature('token-hosoiri', fullUrl, {});
    const res = await app.request(path, {
      headers: { 'X-Twilio-Signature': sig },
    }, { ...env, TWILIO_VALIDATE: 'true', DIAL_QUEUE: mockQueue } as any);
    expect(res.status).toBe(200);
    expect(sent.some((m) => m.body.to === '+8181')).toBe(true);
  });

  it('/play: TWILIO_VALIDATE=true かつ署名なしで 403', async () => {
    const url = `/play?TenantID=hosoiri&Recorder=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, { ...env, TWILIO_VALIDATE: 'true' } as any);
    expect(res.status).toBe(403);
  });
});
