-- Support d'un contrat d'assurance-vie — extension 1:1 de Asset, sur le modèle
-- de RealEstateDetail.
--
-- La valeur et le prix de revient d'un support viennent du journal de
-- transactions, jamais d'ici : ne vivent dans cette table que le contrat de
-- rattachement et les caractéristiques d'un produit structuré.
--
-- `lifeInsuranceId` comble le maillon manquant : rien ne reliait techniquement
-- une position AV à son contrat, le rapprochement devait se faire par nom.
--
-- Les colonnes de produit structuré ne concernent que kind = 'STRUCTURED' et
-- sont donc toutes nullable — un fonds euro n'a ni barrière ni constatation.
CREATE TABLE IF NOT EXISTS "LifeInsuranceSupport" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "lifeInsuranceId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'UC',
    "isin" TEXT,
    "issuer" TEXT,
    "underlying" TEXT,
    "nominalEur" DECIMAL(28,12),
    "strikeLevel" DECIMAL(28,12),
    "couponRatePct" DECIMAL(10,6),
    "couponFrequency" TEXT NOT NULL DEFAULT 'ANNUAL',
    "couponBarrierPct" DECIMAL(10,6),
    "couponMemory" BOOLEAN NOT NULL DEFAULT false,
    "autocallBarrierPct" DECIMAL(10,6),
    "capitalProtectionPct" DECIMAL(10,6),
    "strikeDate" TIMESTAMP(3),
    "maturityDate" TIMESTAMP(3),
    "nextObservationDate" TIMESTAMP(3),
    "lastCouponAppliedAt" TIMESTAMP(3),
    "entryFeePct" DECIMAL(10,6),
    "managementFeePct" DECIMAL(10,6),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifeInsuranceSupport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LifeInsuranceSupport_assetId_key"
    ON "LifeInsuranceSupport"("assetId");
CREATE INDEX IF NOT EXISTS "LifeInsuranceSupport_lifeInsuranceId_idx"
    ON "LifeInsuranceSupport"("lifeInsuranceId");
CREATE INDEX IF NOT EXISTS "LifeInsuranceSupport_kind_idx"
    ON "LifeInsuranceSupport"("kind");

ALTER TABLE "LifeInsuranceSupport" DROP CONSTRAINT IF EXISTS "LifeInsuranceSupport_assetId_fkey";
ALTER TABLE "LifeInsuranceSupport"
    ADD CONSTRAINT "LifeInsuranceSupport_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Le contrat peut disparaître sans emporter la position : les supports restent
-- au journal, seul le rattachement est perdu.
ALTER TABLE "LifeInsuranceSupport" DROP CONSTRAINT IF EXISTS "LifeInsuranceSupport_lifeInsuranceId_fkey";
ALTER TABLE "LifeInsuranceSupport"
    ADD CONSTRAINT "LifeInsuranceSupport_lifeInsuranceId_fkey"
    FOREIGN KEY ("lifeInsuranceId") REFERENCES "LifeInsurance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
