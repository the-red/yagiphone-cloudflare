import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { parseParams } from '../../src/routes/helpers';

describe('parseParams', () => {
  it('GETクエリを解析', async () => {
    const a = new Hono();
    a.get('/t', async (c) => c.json(await parseParams(c as any)));
    const res = await a.request('/t?To=%2B81&From=%2B90');
    expect(await res.json()).toEqual({ To: '+81', From: '+90' });
  });

  it('POSTフォームを解析', async () => {
    const a = new Hono();
    a.post('/t', async (c) => c.json(await parseParams(c as any)));
    const res = await a.request('/t', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'Digits=3&From=%2B90',
    });
    expect(await res.json()).toEqual({ Digits: '3', From: '+90' });
  });
});
