import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // nodejs_compat は @cloudflare/vitest-pool-workers の必須要件のため
          // テストハーネスにのみ付与する（本番 wrangler.jsonc には入れない）。
          compatibilityFlags: ['nodejs_compat'],
          // テスト用D1。マイグレーションは各テストの setup で適用する。
          d1Databases: ['DB'],
        },
      },
    },
  },
});
