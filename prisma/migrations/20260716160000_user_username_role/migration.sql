-- Multi-user auth: username + role (ADMIN | USER)

-- username: default from email local-part for existing rows
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
UPDATE "User"
SET "username" = split_part("email", '@', 1)
WHERE "username" IS NULL OR "username" = '';

-- Resolve duplicates by appending short id suffix
UPDATE "User" u
SET "username" = u."username" || '_' || left(u."id", 6)
WHERE u."id" IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY username ORDER BY "createdAt") AS rn
    FROM "User"
  ) t WHERE t.rn > 1
);

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- role
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'USER';

CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
