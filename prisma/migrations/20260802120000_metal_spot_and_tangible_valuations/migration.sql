-- Cours des métaux précieux : cache partagé, en euro par gramme de métal fin.
CREATE TABLE "MetalSpotPrice" (
    "id" TEXT NOT NULL,
    "metal" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "eurPerGram" DECIMAL(28,12) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetalSpotPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetalSpotPrice_metal_day_key" ON "MetalSpotPrice"("metal", "day");
CREATE INDEX "MetalSpotPrice_metal_day_idx" ON "MetalSpotPrice"("metal", "day");

-- Valorisations datées des objets tangibles.
CREATE TABLE "TangibleValuation" (
    "id" TEXT NOT NULL,
    "tangibleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "valuedAt" TIMESTAMP(3) NOT NULL,
    "valueEur" DECIMAL(28,12) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TangibleValuation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TangibleValuation_tangibleId_valuedAt_idx" ON "TangibleValuation"("tangibleId", "valuedAt");
CREATE INDEX "TangibleValuation_userId_idx" ON "TangibleValuation"("userId");

ALTER TABLE "TangibleValuation" ADD CONSTRAINT "TangibleValuation_tangibleId_fkey"
    FOREIGN KEY ("tangibleId") REFERENCES "TangibleAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
