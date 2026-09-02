-- Échéancier des loyers et charges d'un bien locatif.
-- Reprend le mécanisme de Liability.paymentDay / lastPaymentAppliedAt plutôt
-- que d'introduire un second planificateur.
ALTER TABLE "RealEstateDetail" ADD COLUMN IF NOT EXISTS "rentDay" INTEGER;
ALTER TABLE "RealEstateDetail" ADD COLUMN IF NOT EXISTS "lastRentAppliedAt" TIMESTAMP(3);
ALTER TABLE "RealEstateDetail" ADD COLUMN IF NOT EXISTS "lastChargesAppliedAt" TIMESTAMP(3);
ALTER TABLE "RealEstateDetail" ADD COLUMN IF NOT EXISTS "rentalStartDate" TIMESTAMP(3);
ALTER TABLE "RealEstateDetail" ADD COLUMN IF NOT EXISTS "rentalEndDate" TIMESTAMP(3);
