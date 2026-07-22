-- features_v2 : diff incrémental vs `init` (fix : ce fichier recréait par erreur
-- les tables déjà créées par init, cassant tout `migrate deploy` sur base neuve).

-- User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "baseCurrency" TEXT NOT NULL DEFAULT 'EUR';

-- Platform
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "logoKey" TEXT;
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "walletAddress" TEXT;

-- Asset
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE "Asset" ALTER COLUMN "priceProvider" SET DEFAULT 'FINNHUB';
ALTER TABLE "Asset" RENAME COLUMN "manualPriceEur" TO "manualPrice";
ALTER TABLE "Asset" ALTER COLUMN "manualPrice" TYPE DECIMAL(28,12);

-- Transaction
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- PriceQuote : currency générique remplacée par priceNative + nativeCurrency
ALTER TABLE "PriceQuote" ADD COLUMN IF NOT EXISTS "priceNative" DECIMAL(28,12) NOT NULL DEFAULT 0;
ALTER TABLE "PriceQuote" ADD COLUMN IF NOT EXISTS "nativeCurrency" TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE "PriceQuote" DROP COLUMN IF EXISTS "currency";

-- CreateTable
CREATE TABLE "Liability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initialAmount" DECIMAL(28,12) NOT NULL,
    "remainingAmount" DECIMAL(28,12) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "interestRate" DECIMAL(10,6),
    "monthlyPayment" DECIMAL(28,12),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "platformId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Liability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Liability_userId_idx" ON "Liability"("userId");

-- AddForeignKey
ALTER TABLE "Liability" ADD CONSTRAINT "Liability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Liability" ADD CONSTRAINT "Liability_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE SET NULL ON UPDATE CASCADE;
