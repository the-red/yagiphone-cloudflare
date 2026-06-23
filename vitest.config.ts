import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// @cloudflare/vitest-pool-workers v0.16 以降は vite plugin 形式（cloudflareTest）。
// 旧 defineWorkersConfig / poolOptions.workers は廃止された。
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // nodejs_compat は @cloudflare/vitest-pool-workers の必須要件のため
          // テストハーネスにのみ付与する（本番 wrangler.jsonc には入れない）。
          compatibilityFlags: ['nodejs_compat'],
          // テスト用D1。マイグレーションは各テストの setup で適用する。
          d1Databases: ['DB'],
          // テスト用キュー
          queues: ['DIAL_QUEUE'],
          // テスト内で applyD1Migrations() に渡すマイグレーション情報
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
  };
});
