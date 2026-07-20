import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { loadSeedCredentials } from "../app/lib/env/seed-credentials";
import { seedUserPortfolio } from "./seed-portfolio";

const prisma = new PrismaClient();

/** Efface tout le patrimoine d’un utilisateur (multi-tenant). */
async function wipeUserData(userId: string) {
  await prisma.priceHistory.deleteMany({ where: { asset: { userId } } });
  await prisma.priceQuote.deleteMany({ where: { asset: { userId } } });
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.liabilityEvent
    .deleteMany({ where: { liability: { userId } } })
    .catch(() => undefined);
  await prisma.liability.deleteMany({ where: { userId } });
  await prisma.lifeInsuranceProduct.deleteMany({
    where: { lifeInsurance: { userId } },
  });
  await prisma.lifeInsurance.deleteMany({ where: { userId } });
  await prisma.bankAccount.deleteMany({ where: { userId } });
  await prisma.savingsAccount.deleteMany({ where: { userId } });
  await prisma.envelopeCash.deleteMany({ where: { userId } });
  await prisma.employeeSavingsLine
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.preciousMetalPosition
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.privateEquityPosition
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.crowdlendingPosition
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.tangibleAsset
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  // On-chain txs liées aux plateformes de l’utilisateur
  await prisma.blockchainOnchainTx
    .deleteMany({ where: { userId } })
    .catch(() => undefined);
  await prisma.asset.deleteMany({ where: { userId } });
  await prisma.platform.deleteMany({ where: { userId } });
  await prisma.portfolioSnapshot.deleteMany({ where: { userId } });
}

/**
 * Seed Patrimo — ~30 positions + ~100–120 transactions sur ~3 ans + tous onglets.
 *
 * - Défaut : portfolio sur **admin** et **demo** (wipe des deux cibles seedées).
 * - `SEED_DEMO_ONLY=1` : wipe + seed **demo uniquement** (admin non touché).
 * - `SEED_ADMIN_ONLY=1` : wipe + seed **admin uniquement**.
 * - E2E (`SEED_LIGHT=1` / `E2E=1` / `PLAYWRIGHT=1`) : **demo uniquement**,
 *   **n’efface jamais admin** (évite de vider le patrimoine perso si connecté en admin).
 * - `SEED_SKIP_WIPE=1` : ne wipe personne (upsert users seulement — rare).
 */
async function main() {
  const creds = loadSeedCredentials();
  const {
    adminUsername,
    adminEmail,
    adminPassword,
    demoUsername,
    demoEmail,
    demoPassword,
  } = creds;

  const LIGHT =
    process.env.SEED_LIGHT === "1" ||
    process.env.E2E === "1" ||
    process.env.PLAYWRIGHT === "1";
  const DEMO_ONLY = process.env.SEED_DEMO_ONLY === "1" || LIGHT;
  const ADMIN_ONLY =
    process.env.SEED_ADMIN_ONLY === "1" && !LIGHT && !DEMO_ONLY;
  const SKIP_WIPE = process.env.SEED_SKIP_WIPE === "1";

  console.log(
    LIGHT
      ? "Seeding Patrimo — E2E/LIGHT → wipe+seed **demo uniquement** (admin préservé)…"
      : DEMO_ONLY
        ? "Seeding Patrimo — portfolio DEMO uniquement (admin non wipe)…"
        : ADMIN_ONLY
          ? "Seeding Patrimo — portfolio ADMIN uniquement…"
          : "Seeding Patrimo — portfolios ADMIN + DEMO (3 ans, multi-onglets)…"
  );

  const adminHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      username: adminUsername,
      passwordHash: adminHash,
      role: "ADMIN",
      name: "SuperUser",
      baseCurrency: "EUR",
    },
    create: {
      username: adminUsername,
      email: adminEmail,
      name: "SuperUser",
      passwordHash: adminHash,
      role: "ADMIN",
      baseCurrency: "EUR",
    },
  });
  console.log(`  SuperUser : ${adminUsername} (${admin.id})`);

  const demoHash = await bcrypt.hash(demoPassword, 10);
  const demo = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {
      passwordHash: demoHash,
      name: "Démo Patrimo",
      baseCurrency: "EUR",
      username: demoUsername,
      role: "USER",
    },
    create: {
      email: demoEmail,
      username: demoUsername,
      name: "Démo Patrimo",
      passwordHash: demoHash,
      role: "USER",
      baseCurrency: "EUR",
    },
  });
  console.log(`  Démo USER : ${demoUsername} (${demo.id})`);

  // Ne wipe QUE les comptes qui vont être reseedés.
  // E2E / LIGHT : jamais admin → le patrimoine perso (souvent sur admin) reste intact.
  const targets: Array<{ id: string; tag: string; label: string }> = [];
  if (ADMIN_ONLY) {
    targets.push({ id: admin.id, tag: "Admin", label: adminUsername });
  } else if (DEMO_ONLY || LIGHT) {
    targets.push({ id: demo.id, tag: "Demo", label: demoUsername });
  } else {
    targets.push({ id: admin.id, tag: "Admin", label: adminUsername });
    targets.push({ id: demo.id, tag: "Demo", label: demoUsername });
  }

  if (SKIP_WIPE) {
    console.log("  SEED_SKIP_WIPE=1 → aucun wipe (données existantes conservées)");
  } else {
    for (const t of targets) {
      console.log(`  wipe → ${t.label}`);
      await wipeUserData(t.id);
    }
  }

  for (const t of targets) {
    console.log(`  → Portfolio seedé sur : ${t.label}`);
    const r = await seedUserPortfolio(prisma, t.id, t.tag);
    console.log(
      `     plateformes=${r.platforms} positions=${r.assets} tx=${r.transactions}`
    );
  }

  const adminTx = await prisma.transaction.count({
    where: { userId: admin.id },
  });
  const demoTx = await prisma.transaction.count({ where: { userId: demo.id } });
  const demoAssets = await prisma.asset.count({ where: { userId: demo.id } });
  const demoBanks = await prisma.bankAccount.count({
    where: { userId: demo.id },
  });
  const demoSav = await prisma.savingsAccount.count({
    where: { userId: demo.id },
  });
  const demoLiab = await prisma.liability.count({ where: { userId: demo.id } });
  const demoAv = await prisma.lifeInsurance.count({
    where: { userId: demo.id },
  });
  const demoEmp = await prisma.employeeSavingsLine.count({
    where: { userId: demo.id },
  });
  const demoPm = await prisma.preciousMetalPosition.count({
    where: { userId: demo.id },
  });
  const demoPe = await prisma.privateEquityPosition.count({
    where: { userId: demo.id },
  });
  const demoCl = await prisma.crowdlendingPosition.count({
    where: { userId: demo.id },
  });
  const demoTg = await prisma.tangibleAsset.count({
    where: { userId: demo.id },
  });

  console.log("────────────────────────────────────────");
  console.log("Seed terminé.");
  console.log(`  admin tx    : ${adminTx}`);
  console.log(`  demo tx     : ${demoTx}`);
  console.log(`  demo assets : ${demoAssets}`);
  console.log(
    `  demo modules: banks=${demoBanks} savings=${demoSav} liab=${demoLiab} av=${demoAv} emp=${demoEmp} metals=${demoPm} pe=${demoPe} crowd=${demoCl} tangibles=${demoTg}`
  );
  console.log(
    `  Compte admin : ${adminUsername} (mot de passe = ADMIN_PASSWORD)`
  );
  console.log(
    `  Compte démo  : ${demoUsername} (mot de passe = DEMO_PASSWORD)`
  );
  console.log(
    "  → Les mots de passe ne sont jamais affichés (voir .env / docs/secrets.md)."
  );
  console.log("────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
