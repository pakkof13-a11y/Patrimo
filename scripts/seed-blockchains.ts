/**
 * Insert blockchain platform presets for the demo/local user without overwriting.
 *
 * Usage:
 *   npx tsx scripts/seed-blockchains.ts
 *
 * Rules:
 * - If logoKey or name already exists for the user → skip (no update / no delete)
 * - If missing → insert with type BLOCKCHAIN + subtype
 */

import { createPrismaClient } from "@/app/lib/prisma";
import { PLATFORM_PRESETS } from "../app/lib/platforms/presets";
import { DEMO_EMAIL } from "../app/lib/constants";

const prisma = createPrismaClient();

const BLOCKCHAINS = PLATFORM_PRESETS.filter((p) =>
  p.types.includes("BLOCKCHAIN")
);

async function main() {
  const user =
    (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) ||
    (await prisma.user.findFirst({ orderBy: { createdAt: "asc" } }));

  if (!user) {
    console.error("❌ Aucun utilisateur en base — lancez d'abord: npm run db:seed");
    process.exit(1);
  }

  console.log(`→ Utilisateur: ${user.email} (${user.id})`);
  console.log(`→ ${BLOCKCHAINS.length} blockchain(s) dans le catalogue presets\n`);

  let inserted = 0;
  let skipped = 0;
  const insertedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const b of BLOCKCHAINS) {
    // 1) Check existence by logoKey (preset key) or name (case-insensitive)
    const existing = await prisma.platform.findFirst({
      where: {
        userId: user.id,
        OR: [
          { logoKey: b.key },
          { name: { equals: b.name, mode: "insensitive" } },
          // Match short historical names e.g. "Bitcoin" vs "Bitcoin (BTC)"
          { name: { startsWith: b.name.split(" (")[0], mode: "insensitive" } },
        ],
      },
    });

    if (existing) {
      // 2) Exists → do nothing (no overwrite)
      skipped += 1;
      skippedKeys.push(b.key);
      console.log(`  ↷ skip  ${b.key.padEnd(22)} déjà présent (« ${existing.name} »)`);
      continue;
    }

    // 3) Insert
    await prisma.platform.create({
      data: {
        userId: user.id,
        name: b.name,
        type: "BLOCKCHAIN",
        subtype: b.subtype || null,
        logoKey: b.key,
        logoUrl: b.logoUrl,
        walletAddress: null,
      },
    });
    inserted += 1;
    insertedKeys.push(b.key);
    console.log(`  + insert ${b.key.padEnd(22)} ${b.name} [${b.subtype || "—"}]`);
  }

  // 4) Recap
  console.log("\n════════════════════════════════════════");
  console.log("Récapitulatif seed blockchains");
  console.log("════════════════════════════════════════");
  console.log(`  Insertées : ${inserted}`);
  console.log(`  Ignorées  : ${skipped} (déjà en base)`);
  console.log(`  Total cat.: ${BLOCKCHAINS.length}`);
  if (insertedKeys.length) {
    console.log(`  Nouvelles : ${insertedKeys.join(", ")}`);
  }
  console.log("════════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
