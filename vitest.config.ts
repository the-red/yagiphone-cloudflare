import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
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
            // テスト内で applyD1Migrations() に渡すマイグレーション情報
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
