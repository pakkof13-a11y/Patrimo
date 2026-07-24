/**
 * Smoke test: create a blockchain platform on Neon (same columns as API).
 * Usage: DATABASE_URL=… node scripts/test-platform-create-neon.mjs
 */
import { createPrismaClient } from "@/app/lib/prisma";

const prisma = createPrismaClient();
const name = `E2E Cloud Plat ${Date.now()}`;

try {
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: "demo" }, { username: "admin" }] },
  });
  if (!user) throw new Error("demo/admin user missing");

  const platform = await prisma.platform.create({
    data: {
      userId: user.id,
      name,
      type: "BLOCKCHAIN",
      subtype: "Layer 2 / EVM",
      logoKey: "BASE",
      walletAddress: "0x1111111111111111111111111111111111111111",
      walletApiKey: null,
    },
  });
  console.log("CREATE_OK", platform.id, platform.name, platform.type);

  const classic = await prisma.platform.create({
    data: {
      userId: user.id,
      name: `E2E Courtier ${Date.now()}`,
      type: "COURTIER",
    },
  });
  console.log("CREATE_CLASSIC_OK", classic.id);

  await prisma.platform.deleteMany({
    where: { id: { in: [platform.id, classic.id] } },
  });
  console.log("CLEANUP_OK");
} catch (e) {
  console.error("CREATE_FAIL", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
