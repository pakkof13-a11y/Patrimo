-- Solana RPC: cursor + on-chain tx store (no Solscan)
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "lastKnownSignature" TEXT;
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "BlockchainOnchainTx" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "slot" BIGINT,
    "blockTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "type" TEXT,
    "feeLamports" BIGINT,
    "primaryProgramId" TEXT,
    "programIds" JSONB,
    "transfers" JSONB,
    "rawParsed" JSONB,
    "err" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockchainOnchainTx_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BlockchainOnchainTx_platformId_signature_key" ON "BlockchainOnchainTx"("platformId", "signature");
CREATE INDEX IF NOT EXISTS "BlockchainOnchainTx_userId_platformId_idx" ON "BlockchainOnchainTx"("userId", "platformId");
CREATE INDEX IF NOT EXISTS "BlockchainOnchainTx_platformId_blockTime_idx" ON "BlockchainOnchainTx"("platformId", "blockTime");
CREATE INDEX IF NOT EXISTS "BlockchainOnchainTx_signature_idx" ON "BlockchainOnchainTx"("signature");

DO $$ BEGIN
  ALTER TABLE "BlockchainOnchainTx" ADD CONSTRAINT "BlockchainOnchainTx_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;