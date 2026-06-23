import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { accessMiddleware } from '../../src/auth/access';
import type { Env } from '../../src/env';

function appWith(envOverride: Partial<Env>) {
  const a = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();
  a.use('/admin/*', accessMiddleware);
  a.get('/admin/whoami', (c) => c.json({ email: c.get('userEmail') }));
  return (path: string) => a.request(path, {}, { ...env, ...envOverride } as any);
}

describe('accessMiddleware', () => {
  it('ACCESS_ENABLED=false は dev ユーザーで通過', async () => {
    const res = await appWith({ ACCESS_ENABLED: 'false' })('/admin/whoami');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'dev@local' });
  });

  it('ACCESS_ENABLED=true でJWT無しは401', async () => {
    const res = await appWith({ ACCESS_ENABLED: 'true', ACCESS_AUD: 'aud', ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com' })('/admin/whoami');
    expect(res.status).toBe(401);
  });
});
