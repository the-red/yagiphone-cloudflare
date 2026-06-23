import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, seedTenant } from './helpers/db';

describe('schema', () => {
  beforeAll(async () => { await applyMigrations(); });

  it('tenants へ挿入・取得できる', async () => {
    await seedTenant({ tenant_id: 't1', twilio_caller_id: '+810' });
    const row = await env.DB.prepare('SELECT tenant_id FROM tenants WHERE twilio_caller_id=?')
      .bind('+810').first<{ tenant_id: string }>();
    expect(row?.tenant_id).toBe('t1');
  });
});
