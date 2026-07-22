-- Tables/colonnes manquantes de l'historique de migration : schema.prisma les
-- définit depuis le début mais aucune migration ne les créait — gap découvert
-- via `prisma migrate diff` échouant sur "the underlying table for model
-- SavingsAccount does not exist".

-- Asset.accountType (référencé par 20260717120000_asset_category)
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "accountType" TEXT NOT NULL DEFAULT 'CTO';

-- Liability : colonnes manquantes (déclarées dans schema.prisma, jamais migrées)
ALTER TABLE "Liability" ADD COLUMN IF NOT EXISTS "paymentDay" INTEGER;
ALTER TABLE "Liability" ADD COLUMN IF NOT EXISTS "lastPaymentAppliedAt" TIMESTAMP(3);
ALTER TABLE "Liability" ADD COLUMN IF NOT EXISTS "bankName" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiabilityEvent" (
    "id" TEXT NOT NULL,
    "liabilityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(28,12),
    "remainingAfter" DECIMAL(28,12),
    "eventDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiabilityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LiabilityEvent_liabilityId_eventDate_idx" ON "LiabilityEvent"("liabilityId", "eventDate");

DO $$ BEGIN
  ALTER TABLE "LiabilityEvent" ADD CONSTRAINT "LiabilityEvent_liabilityId_fkey"
    FOREIGN KEY ("liabilityId") REFERENCES "Liability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BankAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "balance" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankAccount_userId_idx" ON "BankAccount"("userId");

DO $$ BEGIN
  ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable (colonnes de base seulement — rateType/payout*/lastPayoutAt ajoutées
-- par 20260715120000_savings_interest_schedule, bankName par 20260720140000_savings_bank_name)
CREATE TABLE IF NOT EXISTS "SavingsAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "apyPercent" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "lastAccruedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SavingsAccount_userId_idx" ON "SavingsAccount"("userId");

DO $$ BEGIN
  ALTER TABLE "SavingsAccount" ADD CONSTRAINT "SavingsAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LifeInsurance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "openDate" TIMESTAMP(3),
    "cashEuro" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifeInsurance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LifeInsurance_userId_idx" ON "LifeInsurance"("userId");

DO $$ BEGIN
  ALTER TABLE "LifeInsurance" ADD CONSTRAINT "LifeInsurance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LifeInsuranceProduct" (
    "id" TEXT NOT NULL,
    "lifeInsuranceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentValue" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifeInsuranceProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LifeInsuranceProduct_lifeInsuranceId_idx" ON "LifeInsuranceProduct"("lifeInsuranceId");

DO $$ BEGIN
  ALTER TABLE "LifeInsuranceProduct" ADD CONSTRAINT "LifeInsuranceProduct_lifeInsuranceId_fkey"
    FOREIGN KEY ("lifeInsuranceId") REFERENCES "LifeInsurance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "EnvelopeCash" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "envelope" TEXT NOT NULL,
    "balance" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvelopeCash_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EnvelopeCash_userId_envelope_key" ON "EnvelopeCash"("userId", "envelope");
CREATE INDEX IF NOT EXISTS "EnvelopeCash_userId_idx" ON "EnvelopeCash"("userId");

DO $$ BEGIN
  ALTER TABLE "EnvelopeCash" ADD CONSTRAINT "EnvelopeCash_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
