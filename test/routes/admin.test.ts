import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { applyMigrations, seedTenant, seedContact } from '../helpers/db';
import { setTwilioClientFactory } from '../../src/routes/twilio';

describe('admin routes', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({ tenant_id: 'hosoiri' });
  });

  it('GET contacts: 空配列', async () => {
    const res = await app.request('/admin/hosoiri/contacts', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('POST contacts: 作成し201', async () => {
    const res = await app.request('/admin/hosoiri/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+8190', name: '太郎', contactType: 'recorder' }),
    }, env);
    expect(res.status).toBe(201);
    expect((await res.json<any>()).contactKey).toBe('recorder#+8190');
  });

  it('POST contacts: 不正なcontactTypeは400', async () => {
    const res = await app.request('/admin/hosoiri/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: '+8190', name: '太郎', contactType: 'bad' }),
    }, env);
    expect(res.status).toBe(400);
  });

  it('DELETE contacts: 204', async () => {
    await seedContact({ tenant_id: 'hosoiri', phone_number: '+8190', contact_type: 'recorder' });
    const res = await app.request(`/admin/hosoiri/contacts/${encodeURIComponent('recorder#+8190')}`, { method: 'DELETE' }, env);
    expect(res.status).toBe(204);
  });

  it('GET recordings: Twilioクライアント結果を返す', async () => {
    setTwilioClientFactory(() => ({ listRecordings: async () => [{ sid: 'RE1', callSid: 'CA1', duration: '1', dateCreated: 'd', uri: '/u' }] }) as any);
    const res = await app.request('/admin/hosoiri/recordings', {}, env);
    expect((await res.json<any[]>())[0].sid).toBe('RE1');
  });

  it('GET usage: start/end 必須', async () => {
    const res = await app.request('/admin/hosoiri/usage', {}, env);
    expect(res.status).toBe(400);
  });

  it('GET usage: 結果を返す', async () => {
    setTwilioClientFactory(() => ({ listUsageRecords: async () => [{ category: 'calls', startDate: 's', endDate: 'e', count: '1', countUnit: 'c', usage: '1', usageUnit: 'min', price: '0' }] }) as any);
    const res = await app.request('/admin/hosoiri/usage?start_date=2024-01-01&end_date=2024-01-31', {}, env);
    expect((await res.json<any[]>())[0].category).toBe('calls');
  });

  // 認可境界: ACCESS_ENABLED=true かつ JWT 無しでは 401（ハンドラに到達しない）
  it('ACCESS_ENABLED=true でJWT無しは401（/admin/* はAccessで保護）', async () => {
    const res = await app.request(
      '/admin/hosoiri/contacts',
      {},
      { ...env, ACCESS_ENABLED: 'true', ACCESS_AUD: 'aud', ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com' } as any,
    );
    expect(res.status).toBe(401);
  });
});
