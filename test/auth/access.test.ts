import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { accessMiddleware } from '../../worker/auth/access';
import type { Env } from '../../worker/env';

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

  it('ACCESS_ENABLED=true で exp が無いJWTは401（多層防御）', async () => {
    // base64url エンコード（実鍵不要: iss/aud は通過するが exp 欠落で署名検証前に401）
    const b64url = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const header = b64url({ alg: 'RS256', kid: 'test' });
    // exp を含まないペイロード（iss/aud は env と一致させ、exp 欠落でのみ失敗させる）
    const payload = b64url({ iss: 'https://t.cloudflareaccess.com', aud: 'aud' });
    const token = `${header}.${payload}.sig`;

    const a = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();
    a.use('/admin/*', accessMiddleware);
    a.get('/admin/whoami', (c) => c.json({ email: c.get('userEmail') }));
    const res = await a.request(
      '/admin/whoami',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      { ...env, ACCESS_ENABLED: 'true', ACCESS_AUD: 'aud', ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com' } as any,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing exp' });
  });
});
