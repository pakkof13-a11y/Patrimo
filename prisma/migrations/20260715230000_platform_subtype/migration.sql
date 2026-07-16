-- Optional subtype on platforms (e.g. Layer 1 / Layer 2 for blockchains)
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "subtype" TEXT;

CREATE INDEX IF NOT EXISTS "Platform_userId_type_idx" ON "Platform"("userId", "type");
