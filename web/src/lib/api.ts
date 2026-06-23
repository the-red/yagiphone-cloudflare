export interface Contact {
  tenantId: string; contactKey: string; name: string; phoneNumber: string;
  contactType: 'recorder' | 'listener';
}
export interface Recording {
  sid: string; callSid: string; duration: string; dateCreated: string; uri: string;
}
export interface UsageRecord {
  category: string; startDate: string; endDate: string; count: string;
  countUnit: string; usage: string; usageUnit: string; price: string;
}
export interface CreateContactInput {
  phoneNumber: string; name: string; contactType: 'recorder' | 'listener';
}

export class ApiClient {
  constructor(private baseUrl: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`API エラー: ${res.status}`);
    return res.status === 204 ? (undefined as T) : res.json();
  }

  listContacts(tenantId: string) { return this.req<Contact[]>(`/admin/${tenantId}/contacts`); }
  createContact(tenantId: string, input: CreateContactInput) {
    return this.req<Contact>(`/admin/${tenantId}/contacts`, { method: 'POST', body: JSON.stringify(input) });
  }
  deleteContact(tenantId: string, contactKey: string) {
    return this.req<void>(`/admin/${tenantId}/contacts/${encodeURIComponent(contactKey)}`, { method: 'DELETE' });
  }
  listRecordings(tenantId: string) { return this.req<Recording[]>(`/admin/${tenantId}/recordings`); }
  listUsageRecords(tenantId: string, startDate: string, endDate: string) {
    return this.req<UsageRecord[]>(`/admin/${tenantId}/usage?start_date=${startDate}&end_date=${endDate}`);
  }
}
