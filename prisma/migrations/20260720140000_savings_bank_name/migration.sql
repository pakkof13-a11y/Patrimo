-- Banque de détention des livrets (comme comptes courants)
ALTER TABLE "SavingsAccount" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
