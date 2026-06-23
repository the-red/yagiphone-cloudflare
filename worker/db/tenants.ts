import type { Tenant } from './types';
import { toTenant } from './types';

export async function getTenant(db: D1Database, tenantId: string): Promise<Tenant | null> {
  const row = await db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').bind(tenantId).first();
  return row ? toTenant(row as any) : null;
}

export async function getTenantByCallerId(db: D1Database, callerId: string): Promise<Tenant | null> {
  const row = await db.prepare('SELECT * FROM tenants WHERE twilio_caller_id = ?').bind(callerId).first();
  return row ? toTenant(row as any) : null;
}
