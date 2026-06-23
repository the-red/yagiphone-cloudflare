import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
