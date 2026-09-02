-- Position futures/perpétuelle : rattachée à l'utilisateur, pas à un Asset —
-- ce n'est pas un actif détenu mais une marge collatéralisant un contrat.
CREATE TABLE "CryptoFuturesPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "subAccountLabel" TEXT,
    "pair" TEXT NOT NULL,
    "contractType" TEXT NOT NULL DEFAULT 'PERPETUAL',
    "marginType" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "leverage" DECIMAL(8,2) NOT NULL,
    "sizeContracts" DECIMAL(28,10) NOT NULL,
    "notionalUsd" DECIMAL(20,2),
    "entryPrice" DECIMAL(20,8) NOT NULL,
    "markPrice" DECIMAL(20,8),
    "liquidationPrice" DECIMAL(20,8),
    "marginUsed" DECIMAL(20,2),
    "fundingPaid" DECIMAL(20,2),
    "commissionPaid" DECIMAL(20,2),
    "unrealizedPnl" DECIMAL(20,2),
    "realizedPnl" DECIMAL(20,2),
    "stopLoss" DECIMAL(20,8),
    "takeProfit" DECIMAL(20,8),
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "exchangeTradeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CryptoFuturesPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CryptoFuturesPosition_userId_isOpen_idx" ON "CryptoFuturesPosition"("userId", "isOpen");
CREATE INDEX "CryptoFuturesPosition_userId_exchange_idx" ON "CryptoFuturesPosition"("userId", "exchange");
CREATE INDEX "CryptoFuturesPosition_userId_closedAt_idx" ON "CryptoFuturesPosition"("userId", "closedAt");
CREATE UNIQUE INDEX "CryptoFuturesPosition_userId_exchangeTradeId_key" ON "CryptoFuturesPosition"("userId", "exchangeTradeId");

ALTER TABLE "CryptoFuturesPosition" ADD CONSTRAINT "CryptoFuturesPosition_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
