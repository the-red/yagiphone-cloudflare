'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { ApiClient, type Contact, type CreateContactInput } from '@/lib/api';
import { ContactTable } from '@/components/ContactTable';
import { ContactForm } from '@/components/ContactForm';

const apiClient = new ApiClient('');

export default function ContactsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.listContacts(tenantId);
      setContacts(data || []);
    } catch (err) {
      console.error('名簿取得エラー:', err);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  async function handleCreate(input: CreateContactInput) {
    await apiClient.createContact(tenantId, input);
    await loadContacts();
  }

  async function handleDelete(contactKey: string) {
    if (!confirm('この名簿を削除しますか？')) return;
    await apiClient.deleteContact(tenantId, contactKey);
    await loadContacts();
  }

  return (
    <div className="space-y-6">
      <ContactForm onSubmit={handleCreate} />
      <ContactTable contacts={contacts} onDelete={handleDelete} isLoading={isLoading} />
    </div>
  );
}
