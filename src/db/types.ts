export interface Tenant {
  tenantId: string;
  name: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioCallerId: string;
  maxRecordingLength: number;
  domain: string | null;
}

export interface Contact {
  tenantId: string;
  contactKey: string;
  name: string;
  phoneNumber: string;
  contactType: 'recorder' | 'listener';
}

interface TenantRow {
  tenant_id: string;
  name: string;
  twilio_account_sid: string;
  twilio_auth_token: string;
  twilio_caller_id: string;
  max_recording_length: number;
  domain: string | null;
}

export function toTenant(r: TenantRow): Tenant {
  return {
    tenantId: r.tenant_id,
    name: r.name,
    twilioAccountSid: r.twilio_account_sid,
    twilioAuthToken: r.twilio_auth_token,
    twilioCallerId: r.twilio_caller_id,
    maxRecordingLength: r.max_recording_length,
    domain: r.domain,
  };
}

interface ContactRow {
  tenant_id: string;
  contact_key: string;
  name: string;
  phone_number: string;
  contact_type: string;
}

export function toContact(r: ContactRow): Contact {
  return {
    tenantId: r.tenant_id,
    contactKey: r.contact_key,
    name: r.name,
    phoneNumber: r.phone_number,
    contactType: r.contact_type as 'recorder' | 'listener',
  };
}
