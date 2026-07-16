-- Actifs alternatifs — métaux précieux
CREATE TABLE "PreciousMetalPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetKind" TEXT NOT NULL DEFAULT 'METAL',
    "format" TEXT NOT NULL DEFAULT 'PHYSICAL',
    "denomination" TEXT NOT NULL,
    "quantity" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "unitWeightG" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "weightUnit" TEXT NOT NULL DEFAULT 'GRAM',
    "purchasePriceUnit" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currentValue" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "storageLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreciousMetalPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PreciousMetalPosition_userId_idx" ON "PreciousMetalPosition"("userId");
CREATE INDEX "PreciousMetalPosition_userId_assetKind_idx" ON "PreciousMetalPosition"("userId", "assetKind");
CREATE INDEX "PreciousMetalPosition_userId_format_idx" ON "PreciousMetalPosition"("userId", "format");

ALTER TABLE "PreciousMetalPosition" ADD CONSTRAINT "PreciousMetalPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
