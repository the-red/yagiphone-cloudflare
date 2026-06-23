// test/queue/dial.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleDialQueue } from '../../src/queue/dial';
import { setTwilioClientFactory } from '../../src/routes/twilio';
import { applyMigrations, seedTenant } from '../helpers/db';
import type { DialMessage } from '../../src/queue/dial';
import type { Env } from '../../src/env';

describe('handleDialQueue コンシューマー', () => {
  beforeEach(async () => {
    await applyMigrations();
    await env.DB.prepare('DELETE FROM contacts').run();
    await env.DB.prepare('DELETE FROM tenants').run();
    await seedTenant({
      tenant_id: 'hosoiri',
      twilio_caller_id: '+815000000001',
      name: '細入',
      domain: 'h.example',
    });
  });

  it('各メッセージの makeCall が呼ばれ、ack される', async () => {
    const calls: { to: string; from: string; url: string }[] = [];
    setTwilioClientFactory(() => ({
      makeCall: async (to: string, from: string, url: string) => {
        calls.push({ to, from, url });
      },
    }) as any);

    const msg1 = {
      body: { tenantId: 'hosoiri', to: '+8181', playUrl: 'https://h.example/play?p=1' },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const msg2 = {
      body: { tenantId: 'hosoiri', to: '+8182', playUrl: 'https://h.example/play?p=2' },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    const batch = { messages: [msg1, msg2] };
    await handleDialQueue(batch as any, env as unknown as Env);

    // 各メッセージに対して makeCall が呼ばれる
    expect(calls.map((c) => c.to).sort()).toEqual(['+8181', '+8182']);
    // from はテナントの twilioCallerId
    expect(calls.every((c) => c.from === '+815000000001')).toBe(true);
    // ack される
    expect(msg1.ack).toHaveBeenCalledOnce();
    expect(msg2.ack).toHaveBeenCalledOnce();
    // retry は呼ばれない
    expect(msg1.retry).not.toHaveBeenCalled();
    expect(msg2.retry).not.toHaveBeenCalled();
  });

  it('makeCall が throw したとき retry が呼ばれる', async () => {
    setTwilioClientFactory(() => ({
      makeCall: async () => { throw new Error('Twilio error'); },
    }) as any);

    const msg = {
      body: { tenantId: 'hosoiri', to: '+8181', playUrl: 'https://h.example/play?p=1' },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await handleDialQueue({ messages: [msg] } as any, env as unknown as Env);

    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('テナントが存在しない場合 ack して次に進む（無限リトライ防止）', async () => {
    setTwilioClientFactory(() => ({
      makeCall: vi.fn(),
    }) as any);

    const msg = {
      body: { tenantId: 'no-such-tenant', to: '+8181', playUrl: 'https://h.example/play?p=1' },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await handleDialQueue({ messages: [msg] } as any, env as unknown as Env);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('同一テナントの複数メッセージは getTenant を1回だけ呼ぶ（キャッシュ）', async () => {
    const calls: string[] = [];
    setTwilioClientFactory(() => ({
      makeCall: async (to: string) => { calls.push(to); },
    }) as any);

    const messages = [
      { body: { tenantId: 'hosoiri', to: '+8181', playUrl: 'https://x/p' }, ack: vi.fn(), retry: vi.fn() },
      { body: { tenantId: 'hosoiri', to: '+8182', playUrl: 'https://x/p' }, ack: vi.fn(), retry: vi.fn() },
      { body: { tenantId: 'hosoiri', to: '+8183', playUrl: 'https://x/p' }, ack: vi.fn(), retry: vi.fn() },
    ];

    await handleDialQueue({ messages } as any, env as unknown as Env);

    // 全メッセージに makeCall が呼ばれる
    expect(calls.sort()).toEqual(['+8181', '+8182', '+8183']);
    // 全 ack される
    messages.forEach((m) => expect(m.ack).toHaveBeenCalledOnce());
  });
});
