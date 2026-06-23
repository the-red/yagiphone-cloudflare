import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

interface Jwk { kid: string; kty: string; alg?: string; n: string; e: string; use?: string; }
// JWKSキャッシュ（モジュール変数、ドメインごとにキャッシュ）
let jwksCache: { domain: string; keys: Jwk[] } | null = null;

/** base64url 文字列をバイト配列に変換 */
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** base64url セグメントをJSONデコード */
function decodeJson(seg: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

/** Cloudflare Access JWKS を取得（ドメインごとにキャッシュ） */
async function fetchJwks(teamDomain: string): Promise<Jwk[]> {
  if (jwksCache && jwksCache.domain === teamDomain) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = await res.json() as { keys: Jwk[] };
  jwksCache = { domain: teamDomain, keys: data.keys };
  return data.keys;
}

/**
 * Cloudflare Access JWT 検証ミドルウェア
 * - ACCESS_ENABLED !== 'true': 検証スキップ（開発バイパス）
 * - ACCESS_ENABLED === 'true': Cf-Access-Jwt-Assertion ヘッダーのJWTをRS256で検証
 */
export const accessMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: { userEmail: string } }> = async (c, next) => {
  // 開発バイパス: ACCESS_ENABLED が 'true' 以外はスキップ
  if (c.env.ACCESS_ENABLED !== 'true') {
    c.set('userEmail', 'dev@local');
    return next();
  }

  // JWTヘッダー取得
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const parts = token.split('.');
  if (parts.length !== 3) return c.json({ error: 'unauthorized' }, 401);

  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);

    // iss 検証
    const expectedIss = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
    if (payload.iss !== expectedIss) return c.json({ error: 'bad issuer' }, 401);

    // aud 検証。ACCESS_AUD はカンマ区切りで複数指定可（本番URLとプレビューURLは別AUDのため）。
    const allowedAuds = c.env.ACCESS_AUD.split(',').map((s) => s.trim()).filter(Boolean);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.some((a: string) => allowedAuds.includes(a))) return c.json({ error: 'bad audience' }, 401);

    // exp 検証（Date.now() はWorkersランタイムで利用可能）
    // exp が無い・数値でないトークンは拒否（多層防御）
    if (typeof payload.exp !== 'number') return c.json({ error: 'missing exp' }, 401);
    if (payload.exp * 1000 < Date.now()) return c.json({ error: 'expired' }, 401);

    // JWKS から kid に一致するキーを取得
    const jwks = await fetchJwks(c.env.ACCESS_TEAM_DOMAIN);
    const jwk = jwks.find((k) => k.kid === header.kid);
    if (!jwk) return c.json({ error: 'unknown key' }, 401);

    // RS256 署名検証（Web Crypto API使用、Node API不使用）
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
    if (!ok) return c.json({ error: 'bad signature' }, 401);

    // 検証成功: userEmail をセット
    c.set('userEmail', payload.email ?? 'unknown');
    return next();
  } catch {
    // パース・検証中のエラーはすべて401
    return c.json({ error: 'unauthorized' }, 401);
  }
};
