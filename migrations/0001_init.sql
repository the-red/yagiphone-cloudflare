-- tenants: 自治会（テナント）設定。Twilio認証情報を保持。
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  twilio_account_sid TEXT NOT NULL,
  twilio_auth_token  TEXT NOT NULL,
  twilio_caller_id   TEXT NOT NULL,
  max_recording_length INTEGER NOT NULL DEFAULT 0,
  domain TEXT
);
CREATE INDEX idx_tenants_caller_id ON tenants(twilio_caller_id);

-- contacts: 名簿。contact_key = "recorder#<番号>" / "listener#<番号>"
CREATE TABLE contacts (
  tenant_id    TEXT NOT NULL,
  contact_key  TEXT NOT NULL,
  name         TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  contact_type TEXT NOT NULL,
  PRIMARY KEY (tenant_id, contact_key)
);
CREATE INDEX idx_contacts_tenant_type ON contacts(tenant_id, contact_type);
