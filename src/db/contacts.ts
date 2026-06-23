import type { Contact } from './types';
import { toContact } from './types';

async function getByKey(db: D1Database, tenantId: string, contactKey: string): Promise<Contact | null> {
  const row = await db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND contact_key = ?')
    .bind(tenantId, contactKey).first();
  return row ? toContact(row as any) : null;
}

export function findRecorder(db: D1Database, tenantId: string, phoneNumber: string) {
  return getByKey(db, tenantId, `recorder#${phoneNumber}`);
}

export async function findContact(db: D1Database, tenantId: string, phoneNumber: string): Promise<Contact | null> {
  for (const type of ['recorder', 'listener']) {
    const c = await getByKey(db, tenantId, `${type}#${phoneNumber}`);
    if (c) return c;
  }
  return null;
}

async function listByType(db: D1Database, tenantId: string, type: string): Promise<Contact[]> {
  const { results } = await db.prepare('SELECT * FROM contacts WHERE tenant_id = ? AND contact_type = ?')
    .bind(tenantId, type).all();
  return (results as any[]).map(toContact);
}

export const listRecorders = (db: D1Database, tenantId: string) => listByType(db, tenantId, 'recorder');
export const listListeners = (db: D1Database, tenantId: string) => listByType(db, tenantId, 'listener');

export async function listAllContacts(db: D1Database, tenantId: string): Promise<Contact[]> {
  const { results } = await db.prepare('SELECT * FROM contacts WHERE tenant_id = ?').bind(tenantId).all();
  return (results as any[]).map(toContact);
}

export async function createContact(db: D1Database, c: Contact): Promise<void> {
  await db.prepare(
    `INSERT INTO contacts (tenant_id, contact_key, name, phone_number, contact_type)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, contact_key) DO UPDATE SET
       name = excluded.name, phone_number = excluded.phone_number, contact_type = excluded.contact_type`,
  ).bind(c.tenantId, c.contactKey, c.name, c.phoneNumber, c.contactType).run();
}

export async function deleteContact(db: D1Database, tenantId: string, contactKey: string): Promise<void> {
  await db.prepare('DELETE FROM contacts WHERE tenant_id = ? AND contact_key = ?')
    .bind(tenantId, contactKey).run();
}
