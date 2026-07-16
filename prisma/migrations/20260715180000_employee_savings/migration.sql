-- Épargne salariale (PEE / PER / PERCO)
CREATE TABLE "EmployeeSavingsLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "manager" TEXT NOT NULL,
    "fundName" TEXT NOT NULL,
    "isin" TEXT,
    "units" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "nav" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "sourceType" TEXT NOT NULL DEFAULT 'VOLUNTARY',
    "contributionDate" TIMESTAMP(3),
    "unlockDate" TIMESTAMP(3),
    "unlockMode" TEXT NOT NULL DEFAULT 'DATE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSavingsLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeSavingsLine_userId_idx" ON "EmployeeSavingsLine"("userId");
CREATE INDEX "EmployeeSavingsLine_userId_planType_idx" ON "EmployeeSavingsLine"("userId", "planType");
CREATE INDEX "EmployeeSavingsLine_userId_manager_idx" ON "EmployeeSavingsLine"("userId", "manager");
CREATE INDEX "EmployeeSavingsLine_isin_idx" ON "EmployeeSavingsLine"("isin");

ALTER TABLE "EmployeeSavingsLine" ADD CONSTRAINT "EmployeeSavingsLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
