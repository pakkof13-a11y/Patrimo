-- Dividendes : pays d'origine / WHT + montants figés sur la transaction

-- Asset
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "countryCode" TEXT;
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "withholdingTaxRate" DECIMAL(8,6);

-- Transaction (snapshot fiscal au moment du paiement)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "withholdingTaxEur" DECIMAL(28,12) NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "withholdingTaxRate" DECIMAL(8,6);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "exDate" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paymentDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Asset_countryCode_idx" ON "Asset"("countryCode");
