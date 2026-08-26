-- CreateTable
CREATE TABLE "CpiObservation" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "monthlyRate" DECIMAL(12,8) NOT NULL,
    "yearlyRate" DECIMAL(12,8),
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CpiObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CpiObservation_source_period_idx" ON "CpiObservation"("source", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CpiObservation_source_period_key" ON "CpiObservation"("source", "period");
