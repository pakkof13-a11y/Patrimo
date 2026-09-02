-- CreateTable
CREATE TABLE "EnvelopeCashEvent" (
    "id" TEXT NOT NULL,
    "envelopeCashId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balanceAfter" DECIMAL(28,12) NOT NULL,
    "amount" DECIMAL(28,12) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvelopeCashEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvelopeCashEvent_envelopeCashId_occurredAt_idx" ON "EnvelopeCashEvent"("envelopeCashId", "occurredAt");

-- CreateIndex
CREATE INDEX "EnvelopeCashEvent_userId_occurredAt_idx" ON "EnvelopeCashEvent"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "EnvelopeCashEvent" ADD CONSTRAINT "EnvelopeCashEvent_envelopeCashId_fkey" FOREIGN KEY ("envelopeCashId") REFERENCES "EnvelopeCash"("id") ON DELETE CASCADE ON UPDATE CASCADE;
