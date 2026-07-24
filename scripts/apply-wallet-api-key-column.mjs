/**
 * Apply walletApiKey column if missing (bypass prisma migrate advisory lock).
 * Usage: DATABASE_URL=… node scripts/apply-wallet-api-key-column.mjs
 */
import { createPrismaClient } from "@/app/lib/prisma";

const p = createPrismaClient();
try {
  await p.$executeRawUnsafe(
    `ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "walletApiKey" TEXT`
  );
  // Record migration if table exists
  try {
    await p.$executeRawUnsafe(`
      INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      SELECT
        '20260720120000_platform_wallet_api_key',
        'manual-apply-walletApiKey',
        NOW(),
        '20260720120000_platform_wallet_api_key',
        NULL,
        NULL,
        NOW(),
        1
      WHERE NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260720120000_platform_wallet_api_key'
      )
    `);
  } catch (e) {
    console.warn("migration table note:", e instanceof Error ? e.message : e);
  }
  const cols = await p.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Platform' AND column_name = 'walletApiKey'
  `;
  console.log("walletApiKey present:", Array.isArray(cols) && cols.length > 0, cols);
} finally {
  await p.$disconnect();
}
