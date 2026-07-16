-- Dynamic interest schedule for savings (livrets)
ALTER TABLE "SavingsAccount" ADD COLUMN IF NOT EXISTS "rateType" TEXT NOT NULL DEFAULT 'APY';
ALTER TABLE "SavingsAccount" ADD COLUMN IF NOT EXISTS "payoutFrequency" TEXT NOT NULL DEFAULT 'DAILY';
ALTER TABLE "SavingsAccount" ADD COLUMN IF NOT EXISTS "payoutDayOfWeek" INTEGER;
ALTER TABLE "SavingsAccount" ADD COLUMN IF NOT EXISTS "payoutDayOfMonth" INTEGER;
ALTER TABLE "SavingsAccount" ADD COLUMN IF NOT EXISTS "payoutMonth" INTEGER;
ALTER TABLE "SavingsAccount" ADD COLUMN IF NOT EXISTS "lastPayoutAt" TIMESTAMP(3);
