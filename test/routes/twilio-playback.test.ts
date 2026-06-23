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

  it('/dial: 各listenerにmakeCallし空Responseを返す', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8181', contact_type: 'listener', name: 'L1' });
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8182', contact_type: 'listener', name: 'L2' });
    const calls: { to: string; from: string; url: string }[] = [];
    setTwilioClientFactory(() => ({
      makeCall: async (to: string, from: string, url: string) => { calls.push({ to, from, url }); },
    }) as any);
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, env);
    expect(calls.map((c) => c.to).sort()).toEqual(['+8181', '+8182']);
    // 各発信の from はテナントの twilioCallerId（seed した値）と一致する
    expect(calls.every((c) => c.from === TO)).toBe(true);
    // 各発信の url はテナントの domain の /play で、Recorder/RecordingUrl/TenantID を含む
    expect(calls.every((c) =>
      c.url.includes('https://h.example/play?Recorder=')
      && c.url.includes(`RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`)
      && c.url.includes('TenantID=hosoiri'),
    )).toBe(true);
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  // --- 署名検証テスト（TWILIO_VALIDATE='true' 時）---

  it('/dial: TWILIO_VALIDATE=true かつ署名なしで 403、makeCall 未呼び出し', async () => {
    const calls: string[] = [];
    setTwilioClientFactory(() => ({
      makeCall: async (to: string) => { calls.push(to); },
    }) as any);
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, { ...env, TWILIO_VALIDATE: 'true' } as any);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('/dial: TWILIO_VALIDATE=true かつ正当な署名で 200、makeCall 呼び出し', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8181', contact_type: 'listener', name: 'L1' });
    const calls: string[] = [];
    setTwilioClientFactory(() => ({
      makeCall: async (to: string) => { calls.push(to); },
    }) as any);
    // Hono の app.request に相対パスを渡すと内部では http://localhost/ をベースにする
    const path = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const fullUrl = `http://localhost${path}`;
    // GET リクエストなのでパラメータは空オブジェクト（URL にクエリが含まれる）
    const sig = await computeSignature('token-hosoiri', fullUrl, {});
    const res = await app.request(path, {
      headers: { 'X-Twilio-Signature': sig },
    }, { ...env, TWILIO_VALIDATE: 'true' } as any);
    expect(res.status).toBe(200);
    expect(calls).toContain('+8181');
  });

  it('/play: TWILIO_VALIDATE=true かつ署名なしで 403', async () => {
    const url = `/play?TenantID=hosoiri&Recorder=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, { ...env, TWILIO_VALIDATE: 'true' } as any);
    expect(res.status).toBe(403);
  });
});
