-- CreateTable
CREATE TABLE "AssetEnvelopeEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "securitiesAccountId" TEXT,
    "envelopeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEnvelopeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetEnvelopeEvent_assetId_occurredAt_idx" ON "AssetEnvelopeEvent"("assetId", "occurredAt");

-- CreateIndex
CREATE INDEX "AssetEnvelopeEvent_userId_occurredAt_idx" ON "AssetEnvelopeEvent"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "AssetEnvelopeEvent" ADD CONSTRAINT "AssetEnvelopeEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Amorçage : un constat daté, jamais une reconstruction ────────────────────
--
-- Chaque ligne titre existante reçoit un unique événement `OBSERVED` daté de
-- MAINTENANT. Il dit exactement ceci : « au moment où le journal a été mis en
-- place, cette ligne était dans cette enveloppe ». Il n'affirme rien sur avant.
--
-- Pourquoi pas `Asset."createdAt"` : cette colonne mesure l'écriture en base,
-- pas l'entrée dans l'enveloppe. Mesuré sur le compte de démonstration — ses
-- seize lignes titres portent un `createdAt` de 2026 alors que leurs premières
-- opérations remontent à 2023. Dater l'événement ainsi affirmerait une
-- appartenance que rien ne démontre.
--
-- Pourquoi pas la première transaction : rien ne dit que l'enveloppe d'alors
-- était celle d'aujourd'hui — c'est précisément l'information qui manque et que
-- ce journal existe pour ne plus perdre.
--
-- Toute date antérieure à ce constat reste donc « inconnue », ce qui est la
-- réponse juste.
--
-- Restreint aux enveloppes titres : les autres (AV, CRYPTO, IMMOBILIER) sortent
-- du périmètre PEA/CTO. Une ligne qui les rejoindrait plus tard sera journalisée
-- par la mutation elle-même.
INSERT INTO "AssetEnvelopeEvent" (
  "id", "assetId", "userId", "occurredAt", "kind",
  "accountType", "securitiesAccountId", "envelopeType", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  a."id",
  a."userId",
  NOW(),
  'OBSERVED',
  a."accountType",
  a."securitiesAccountId",
  sa."envelopeType",
  NOW()
FROM "Asset" a
LEFT JOIN "SecuritiesAccount" sa ON sa."id" = a."securitiesAccountId"
WHERE a."accountType" IN ('CTO', 'PEA');
