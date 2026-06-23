const BASE_URL = 'https://api.twilio.com';

export interface Recording { sid: string; callSid: string; duration: string; dateCreated: string; uri: string; }
export interface UsageRecord {
  category: string; startDate: string; endDate: string; count: string;
  countUnit: string; usage: string; usageUnit: string; price: string;
}

export class TwilioClient {
  constructor(
    private accountSid: string,
    private authToken: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeader(): string {
    return 'Basic ' + btoa(`${this.accountSid}:${this.authToken}`);
  }

  async makeCall(to: string, from: string, callUrl: string): Promise<void> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
    const form = new URLSearchParams({ To: to, From: from, Url: callUrl, Method: 'GET' });
    const res = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (res.status >= 400) throw new Error(`Twilio API エラー: status=${res.status}`);
  }

  async listRecordings(limit: number): Promise<Recording[]> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Recordings.json?PageSize=${limit}`;
    const res = await this.fetchImpl(endpoint, { headers: { Authorization: this.authHeader() } });
    const data = await res.json() as { recordings?: any[] };
    return (data.recordings ?? []).map((r) => ({
      sid: r.sid, callSid: r.call_sid, duration: r.duration, dateCreated: r.date_created, uri: r.uri,
    }));
  }

  async listUsageRecords(startDate: string, endDate: string): Promise<UsageRecord[]> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Usage/Records.json?StartDate=${startDate}&EndDate=${endDate}`;
    const res = await this.fetchImpl(endpoint, { headers: { Authorization: this.authHeader() } });
    const data = await res.json() as { usage_records?: any[] };
    return (data.usage_records ?? []).map((u) => ({
      category: u.category, startDate: u.start_date, endDate: u.end_date, count: u.count,
      countUnit: u.count_unit, usage: u.usage, usageUnit: u.usage_unit, price: u.price,
    }));
  }

  async getCallFrom(callSid: string): Promise<string> {
    const endpoint = `${BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Calls/${callSid}.json`;
    const res = await this.fetchImpl(endpoint, { headers: { Authorization: this.authHeader() } });
    const data = await res.json() as { from?: string };
    return data.from ?? '';
  }
}

export function recordingUrl(uri: string): string {
  return BASE_URL + uri.replace(/\.json$/, '');
}
