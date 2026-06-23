import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { applyMigrations, seedTenant, seedContact } from '../helpers/db';
import { setTwilioClientFactory, formatRecordingDate } from '../../src/routes/twilio';

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
    const calls: string[] = [];
    setTwilioClientFactory(() => ({ makeCall: async (to: string) => { calls.push(to); } }) as any);
    const url = `/dial?TenantID=hosoiri&Caller=${encodeURIComponent('+8190')}&RecordingUrl=${encodeURIComponent('https://x/a.mp3')}`;
    const res = await app.request(url, {}, env);
    expect(calls.sort()).toEqual(['+8181', '+8182']);
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});
