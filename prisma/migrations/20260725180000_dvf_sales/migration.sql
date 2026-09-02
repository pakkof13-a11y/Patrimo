-- Référentiel DVF (ventes immobilières publiques, Etalab).
-- Données partagées, non rattachées à un utilisateur, entièrement
-- reconstructibles depuis la source.

CREATE TABLE IF NOT EXISTS "DvfImport" (
    "id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "salesStored" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "rejectReasons" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "DvfImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DvfImport_department_year_key"
    ON "DvfImport"("department", "year");

CREATE TABLE IF NOT EXISTS "DvfSale" (
    "id" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "soldOn" TIMESTAMP(3) NOT NULL,
    "propertyType" TEXT NOT NULL,
    "valueEur" DECIMAL(14,2) NOT NULL,
    "builtAreaM2" INTEGER NOT NULL,
    "rooms" INTEGER NOT NULL,
    "landAreaM2" INTEGER,
    "pricePerM2" DECIMAL(12,2) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "postalCode" TEXT,
    "inseeCode" TEXT NOT NULL,
    "communeName" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "hasDependency" BOOLEAN NOT NULL DEFAULT false,
    "sourceRows" INTEGER NOT NULL DEFAULT 1,
    "importId" TEXT NOT NULL,

    CONSTRAINT "DvfSale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DvfSale_mutationId_propertyType_key"
    ON "DvfSale"("mutationId", "propertyType");

-- Pré-filtre par boîte englobante : la latitude mène l'index, la longitude
-- affine dans la plage retenue.
CREATE INDEX IF NOT EXISTS "DvfSale_latitude_longitude_idx"
    ON "DvfSale"("latitude", "longitude");

CREATE INDEX IF NOT EXISTS "DvfSale_department_soldOn_idx"
    ON "DvfSale"("department", "soldOn");

CREATE INDEX IF NOT EXISTS "DvfSale_inseeCode_idx"
    ON "DvfSale"("inseeCode");

CREATE INDEX IF NOT EXISTS "DvfSale_importId_idx"
    ON "DvfSale"("importId");

ALTER TABLE "DvfSale" DROP CONSTRAINT IF EXISTS "DvfSale_importId_fkey";
ALTER TABLE "DvfSale"
    ADD CONSTRAINT "DvfSale_importId_fkey"
    FOREIGN KEY ("importId") REFERENCES "DvfImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
