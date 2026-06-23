import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrations } from '../helpers/db';
import {
  findContact, findRecorder, listRecorders, listListeners,
  listAllContacts, createContact, deleteContact,
} from '../../worker/db/contacts';

describe('contacts queries', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
  });

  it('createContact + findRecorder', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+8190', name: '太郎', phoneNumber: '+8190', contactType: 'recorder' });
    const r = await findRecorder(env.DB, 't', '+8190');
    expect(r?.name).toBe('太郎');
    expect(await findRecorder(env.DB, 't', '+0000')).toBeNull();
  });

  it('findContact は recorder/listener 両方を探す', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'listener#+8191', name: '花子', phoneNumber: '+8191', contactType: 'listener' });
    const c = await findContact(env.DB, 't', '+8191');
    expect(c?.contactType).toBe('listener');
    expect(await findContact(env.DB, 't', '+9999')).toBeNull();
  });

  it('listRecorders / listListeners / listAllContacts', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+1', name: 'a', phoneNumber: '+1', contactType: 'recorder' });
    await createContact(env.DB, { tenantId: 't', contactKey: 'listener#+2', name: 'b', phoneNumber: '+2', contactType: 'listener' });
    expect((await listRecorders(env.DB, 't')).length).toBe(1);
    expect((await listListeners(env.DB, 't')).length).toBe(1);
    expect((await listAllContacts(env.DB, 't')).length).toBe(2);
  });

  it('createContact はupsert / deleteContact', async () => {
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+1', name: 'old', phoneNumber: '+1', contactType: 'recorder' });
    await createContact(env.DB, { tenantId: 't', contactKey: 'recorder#+1', name: 'new', phoneNumber: '+1', contactType: 'recorder' });
    expect((await findRecorder(env.DB, 't', '+1'))?.name).toBe('new');
    await deleteContact(env.DB, 't', 'recorder#+1');
    expect(await findRecorder(env.DB, 't', '+1')).toBeNull();
  });
});
