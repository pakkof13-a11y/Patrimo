-- CreateTable: compte de trading à levier (CFD, futures, spread betting).
CREATE TABLE "TradingAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "brokerName" TEXT NOT NULL,
  "accountType" TEXT NOT NULL DEFAULT 'MIXED',
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "balance" DECIMAL(28,12) NOT NULL DEFAULT 0,
  "marginAvailable" DECIMAL(28,12),
  "openDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradingAccount_userId_idx" ON "TradingAccount"("userId");
CREATE INDEX "TradingAccount_userId_accountType_idx" ON "TradingAccount"("userId", "accountType");

ALTER TABLE "TradingAccount"
  ADD CONSTRAINT "TradingAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: généralisation des positions à levier aux sous-jacents non crypto.
--
-- La table n'est **pas** renommée : seul le modèle Prisma devient
-- `TradingPosition`, via `@@map("CryptoFuturesPosition")`. Aucune donnée n'est
-- déplacée, les positions futures déjà enregistrées sont donc intactes.
ALTER TABLE "CryptoFuturesPosition"
  ADD COLUMN "tradingAccountId" TEXT,
  -- Défaut CRYPTO : c'est ce que la table contenait avant l'ouverture aux CFD,
  -- le défaut préserve donc le sens des lignes existantes sans reprise.
  ADD COLUMN "underlyingType" TEXT NOT NULL DEFAULT 'CRYPTO',
  ADD COLUMN "expiryDate" TIMESTAMP(3),
  ADD COLUMN "tickValue" DECIMAL(20,8);

-- `marginType` (USDT_M | COIN_M) est propre aux futures crypto : un CFD sur
-- indice n'en a pas. On relâche la contrainte plutôt que d'imposer une valeur
-- de remplissage qui n'aurait aucun sens.
ALTER TABLE "CryptoFuturesPosition" ALTER COLUMN "marginType" DROP NOT NULL;

CREATE INDEX "CryptoFuturesPosition_userId_underlyingType_idx"
  ON "CryptoFuturesPosition"("userId", "underlyingType");
CREATE INDEX "CryptoFuturesPosition_tradingAccountId_idx"
  ON "CryptoFuturesPosition"("tradingAccountId");

-- SetNull : supprimer un compte ne supprime jamais l'historique des positions
-- qu'il portait — le journal de trading et le P&L réalisé restent lisibles.
ALTER TABLE "CryptoFuturesPosition"
  ADD CONSTRAINT "CryptoFuturesPosition_tradingAccountId_fkey"
  FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
