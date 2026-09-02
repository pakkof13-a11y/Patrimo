-- AlterTable: BankAccount — compte pro / joint
ALTER TABLE "BankAccount"
  ADD COLUMN "isPro" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ownershipPct" DECIMAL(6,3);

-- AlterTable: SavingsAccount — type de produit réglementé, plafond, pro / joint
ALTER TABLE "SavingsAccount"
  ADD COLUMN "productType" TEXT NOT NULL DEFAULT 'AUTRE',
  ADD COLUMN "ceilingAmount" DECIMAL(28,12),
  ADD COLUMN "isPro" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ownershipPct" DECIMAL(6,3);

-- CreateTable: historique compte courant
CREATE TABLE "BankAccountEvent" (
  "id" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(28,12) NOT NULL,
  "balanceAfter" DECIMAL(28,12) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankAccountEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankAccountEvent_bankAccountId_occurredAt_idx"
  ON "BankAccountEvent"("bankAccountId", "occurredAt");

ALTER TABLE "BankAccountEvent"
  ADD CONSTRAINT "BankAccountEvent_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: historique livret
CREATE TABLE "SavingsAccountEvent" (
  "id" TEXT NOT NULL,
  "savingsAccountId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(28,12) NOT NULL,
  "balanceAfter" DECIMAL(28,12) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavingsAccountEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavingsAccountEvent_savingsAccountId_occurredAt_idx"
  ON "SavingsAccountEvent"("savingsAccountId", "occurredAt");

ALTER TABLE "SavingsAccountEvent"
  ADD CONSTRAINT "SavingsAccountEvent_savingsAccountId_fkey"
  FOREIGN KEY ("savingsAccountId") REFERENCES "SavingsAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: dépôt à terme (CAT)
CREATE TABLE "TermDeposit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bankName" TEXT,
  "principal" DECIMAL(28,12) NOT NULL,
  "ratePercent" DECIMAL(10,6) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "openedAt" TIMESTAMP(3) NOT NULL,
  "maturityDate" TIMESTAMP(3) NOT NULL,
  "earlyWithdrawalPenaltyPct" DECIMAL(6,3),
  "isPro" BOOLEAN NOT NULL DEFAULT false,
  "ownershipPct" DECIMAL(6,3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TermDeposit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TermDeposit_userId_idx" ON "TermDeposit"("userId");

ALTER TABLE "TermDeposit"
  ADD CONSTRAINT "TermDeposit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
