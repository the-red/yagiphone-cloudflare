import { Hono } from 'hono';
import type { Env } from '../env';
import { getTenant } from '../db/tenants';
import { listAllContacts, createContact, deleteContact } from '../db/contacts';
import { getTwilioClient } from './twilio';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();

// GET /admin/:tenantId/contacts → 全コンタクト一覧
adminRoutes.get('/admin/:tenantId/contacts', async (c) => {
  const tenantId = c.req.param('tenantId');
  return c.json(await listAllContacts(c.env.DB, tenantId));
});

// POST /admin/:tenantId/contacts → コンタクト作成（201）
adminRoutes.post('/admin/:tenantId/contacts', async (c) => {
  const tenantId = c.req.param('tenantId');
  let input: { phoneNumber?: string; name?: string; contactType?: string };
  try { input = await c.req.json(); } catch { return c.text('リクエストが不正です', 400); }
  if (input.contactType !== 'recorder' && input.contactType !== 'listener') {
    return c.text('contactType は recorder または listener', 400);
  }
  const contact = {
    tenantId,
    contactKey: `${input.contactType}#${input.phoneNumber ?? ''}`,
    name: input.name ?? '',
    phoneNumber: input.phoneNumber ?? '',
    contactType: input.contactType,
  } as const;
  await createContact(c.env.DB, contact);
  return c.json(contact, 201);
});

// DELETE /admin/:tenantId/contacts/:contactKey → コンタクト削除（204）
adminRoutes.delete('/admin/:tenantId/contacts/:contactKey', async (c) => {
  const tenantId = c.req.param('tenantId');
  const contactKey = decodeURIComponent(c.req.param('contactKey'));
  await deleteContact(c.env.DB, tenantId, contactKey);
  return c.body(null, 204);
});

// GET /admin/:tenantId/recordings → 録音一覧
adminRoutes.get('/admin/:tenantId/recordings', async (c) => {
  const tenantId = c.req.param('tenantId');
  const tenant = await getTenant(c.env.DB, tenantId);
  if (!tenant) return c.text('テナントが見つかりません', 404);
  return c.json(await getTwilioClient(tenant).listRecordings(200));
});

// GET /admin/:tenantId/usage?start_date&end_date → 利用状況
adminRoutes.get('/admin/:tenantId/usage', async (c) => {
  const tenantId = c.req.param('tenantId');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  if (!startDate || !endDate) return c.text('start_date と end_date は必須です', 400);
  const tenant = await getTenant(c.env.DB, tenantId);
  if (!tenant) return c.text('テナントが見つかりません', 404);
  return c.json(await getTwilioClient(tenant).listUsageRecords(startDate, endDate));
});
