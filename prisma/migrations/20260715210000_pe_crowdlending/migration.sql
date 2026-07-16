-- Private equity / non-coté
CREATE TABLE "PrivateEquityPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "sector" TEXT,
    "peType" TEXT NOT NULL DEFAULT 'DIRECT',
    "shares" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "acquisitionPricePerShare" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "investmentDate" TIMESTAMP(3),
    "currentNav" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateEquityPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivateEquityPosition_userId_idx" ON "PrivateEquityPosition"("userId");
CREATE INDEX "PrivateEquityPosition_userId_peType_idx" ON "PrivateEquityPosition"("userId", "peType");

ALTER TABLE "PrivateEquityPosition" ADD CONSTRAINT "PrivateEquityPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Crowdlending / dette privée
CREATE TABLE "CrowdlendingPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "platform" TEXT,
    "capitalInvested" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "annualYieldPercent" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "durationMonths" INTEGER NOT NULL DEFAULT 12,
    "repaymentType" TEXT NOT NULL DEFAULT 'IN_FINE',
    "startDate" TIMESTAMP(3),
    "maturityDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrowdlendingPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrowdlendingPosition_userId_idx" ON "CrowdlendingPosition"("userId");
CREATE INDEX "CrowdlendingPosition_userId_status_idx" ON "CrowdlendingPosition"("userId", "status");

ALTER TABLE "CrowdlendingPosition" ADD CONSTRAINT "CrowdlendingPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
