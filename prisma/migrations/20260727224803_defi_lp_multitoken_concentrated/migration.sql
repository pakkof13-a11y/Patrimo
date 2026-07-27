-- AlterTable
ALTER TABLE "DefiPositionDetail"
  ADD COLUMN "pairedEntryPriceEur" DECIMAL(28,12),
  ADD COLUMN "pairedLegs" JSONB,
  ADD COLUMN "isConcentrated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "priceRangeMin" DECIMAL(38,18),
  ADD COLUMN "priceRangeMax" DECIMAL(38,18),
  ADD COLUMN "token1AllocationPct" DECIMAL(6,3),
  ADD COLUMN "pairedAllocationPct" DECIMAL(6,3);
