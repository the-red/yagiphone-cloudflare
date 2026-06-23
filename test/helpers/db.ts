import { env, applyD1Migrations } from 'cloudflare:test';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  }
}

export async function applyMigrations(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

export async function seedTenant(partial: Partial<Record<string, string | number>> = {}) {
  const t = {
    tenant_id: 'hosoiri',
    name: '細入',
    twilio_account_sid: 'ACxxxx',
    twilio_auth_token: 'token-hosoiri',
    twilio_caller_id: '+815000000001',
    max_recording_length: 0,
    domain: 'example.test',
    ...partial,
  };
  await env.DB.prepare(
    `INSERT INTO tenants (tenant_id,name,twilio_account_sid,twilio_auth_token,twilio_caller_id,max_recording_length,domain)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(t.tenant_id, t.name, t.twilio_account_sid, t.twilio_auth_token, t.twilio_caller_id, t.max_recording_length, t.domain).run();
  return t;
}

export async function seedContact(partial: Partial<Record<string, string>> = {}) {
  const phone = partial.phone_number ?? '+819000000001';
  const type = partial.contact_type ?? 'recorder';
  const c = {
    tenant_id: 'hosoiri',
    contact_key: `${type}#${phone}`,
    name: '山田太郎',
    phone_number: phone,
    contact_type: type,
    ...partial,
  };
  await env.DB.prepare(
    `INSERT INTO contacts (tenant_id,contact_key,name,phone_number,contact_type) VALUES (?,?,?,?,?)`,
  ).bind(c.tenant_id, c.contact_key, c.name, c.phone_number, c.contact_type).run();
  return c;
}
