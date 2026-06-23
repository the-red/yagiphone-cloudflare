import { describe, it, expect, vi } from 'vitest';
import { TwilioClient, recordingUrl } from '../src/twilio/client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('TwilioClient', () => {
  it('makeCall は Calls.json にPOSTしBasic認証を付ける', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 201 }));
    const c = new TwilioClient('ACsid', 'tok', fetchMock as any);
    await c.makeCall('+81to', '+81from', 'https://x/play');
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACsid/Calls.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('ACsid:tok'));
    expect(init.body).toContain('To=%2B81to');
    expect(init.body).toContain('Method=GET');
  });

  it('makeCall は4xxで例外', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 400 }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    await expect(c.makeCall('a', 'b', 'c')).rejects.toThrow();
  });

  it('listRecordings はcamelCaseで返し、リクエスト形状が正しい', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ recordings: [{ sid: 'RE1', call_sid: 'CA1', duration: '5', date_created: 'd', uri: '/x.json' }] }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    const recs = await c.listRecordings(1);
    expect(recs[0]).toEqual({ sid: 'RE1', callSid: 'CA1', duration: '5', dateCreated: 'd', uri: '/x.json' });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('Recordings.json?PageSize=1');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('s:t'));
  });

  it('listUsageRecords はcamelCaseで返し、リクエスト形状が正しい', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      usage_records: [{
        category: 'calls', start_date: '2024-01-01', end_date: '2024-01-31', count: '5',
        count_unit: 'calls', usage: '10', usage_unit: 'min', price: '0.5',
      }],
    }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    const records = await c.listUsageRecords('2024-01-01', '2024-01-31');
    expect(records[0]).toEqual({
      category: 'calls', startDate: '2024-01-01', endDate: '2024-01-31', count: '5',
      countUnit: 'calls', usage: '10', usageUnit: 'min', price: '0.5',
    });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('Usage/Records.json?StartDate=2024-01-01&EndDate=2024-01-31');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('s:t'));
  });

  it('getCallFrom は from を返し、リクエスト形状が正しい', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ from: '+8190' }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    expect(await c.getCallFrom('CA1')).toBe('+8190');
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('Calls/CA1.json');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('s:t'));
  });

  it('recordingUrl は.jsonを除去してフルURL化', () => {
    expect(recordingUrl('/2010-04-01/Accounts/AC/Recordings/RE1.json'))
      .toBe('https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1');
  });
});
