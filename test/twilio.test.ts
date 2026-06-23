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

  it('listRecordings はcamelCaseで返す', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ recordings: [{ sid: 'RE1', call_sid: 'CA1', duration: '5', date_created: 'd', uri: '/x.json' }] }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    const recs = await c.listRecordings(1);
    expect(recs[0]).toEqual({ sid: 'RE1', callSid: 'CA1', duration: '5', dateCreated: 'd', uri: '/x.json' });
  });

  it('getCallFrom は from を返す', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ from: '+8190' }));
    const c = new TwilioClient('s', 't', fetchMock as any);
    expect(await c.getCallFrom('CA1')).toBe('+8190');
  });

  it('recordingUrl は.jsonを除去してフルURL化', () => {
    expect(recordingUrl('/2010-04-01/Accounts/AC/Recordings/RE1.json'))
      .toBe('https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1');
  });
});
