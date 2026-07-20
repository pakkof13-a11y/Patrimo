-- Clé API wallet par plateforme (Zerion, etc.) — présente dans schema.prisma
-- mais jamais migrée → INSERT cloud échouait avec « Erreur serveur ».
ALTER TABLE "Platform" ADD COLUMN IF NOT EXISTS "walletApiKey" TEXT;
