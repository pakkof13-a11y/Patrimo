-- CreateTable: regroupement optionnel de positions DeFi liées
CREATE TABLE "DefiStrategy" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DefiStrategy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DefiStrategy_userId_idx" ON "DefiStrategy"("userId");

ALTER TABLE "DefiStrategy"
  ADD CONSTRAINT "DefiStrategy_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: DefiPositionDetail — rattachement stratégie, rewards multiples,
-- lock/vesting, métadonnées déclaratives
ALTER TABLE "DefiPositionDetail"
  ADD COLUMN "strategyId" TEXT,
  ADD COLUMN "extraRewardLegs" JSONB,
  ADD COLUMN "unlockAt" TIMESTAMP(3),
  ADD COLUMN "cliffAt" TIMESTAMP(3),
  ADD COLUMN "vestingSchedule" JSONB,
  ADD COLUMN "metadata" JSONB;

CREATE INDEX "DefiPositionDetail_strategyId_idx" ON "DefiPositionDetail"("strategyId");

ALTER TABLE "DefiPositionDetail"
  ADD CONSTRAINT "DefiPositionDetail_strategyId_fkey"
  FOREIGN KEY ("strategyId") REFERENCES "DefiStrategy"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
