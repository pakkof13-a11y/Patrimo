-- Actifs tangibles & collection
CREATE TABLE "TangibleAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "brandOrArtist" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "yearOrVintage" TEXT,
    "purchasePrice" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "estimatedValue" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "hasCertificate" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TangibleAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TangibleAsset_userId_idx" ON "TangibleAsset"("userId");
CREATE INDEX "TangibleAsset_userId_category_idx" ON "TangibleAsset"("userId", "category");

ALTER TABLE "TangibleAsset" ADD CONSTRAINT "TangibleAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
