import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, seedTenant } from '../helpers/db';
import { getTenant, getTenantByCallerId } from '../../src/db/tenants';

describe('tenants queries', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedTenant({ tenant_id: 'hosoiri', twilio_caller_id: '+815000000001', name: '細入' });
  });

  it('getTenant: IDで取得しcamelCaseで返す', async () => {
    const t = await getTenant(env.DB, 'hosoiri');
    expect(t?.name).toBe('細入');
    expect(t?.twilioCallerId).toBe('+815000000001');
  });

  it('getTenant: 不在はnull', async () => {
    expect(await getTenant(env.DB, 'none')).toBeNull();
  });

  it('getTenantByCallerId: callerIdで取得', async () => {
    const t = await getTenantByCallerId(env.DB, '+815000000001');
    expect(t?.tenantId).toBe('hosoiri');
  });
});
