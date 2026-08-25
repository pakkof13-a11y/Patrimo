/**
 * Bascule de l'assurance-vie vers le journal de transactions.
 *
 * ```
 * # État des lieux, sans rien modifier (par défaut)
 * npx tsx scripts/migrate-life-insurance.ts --user demo
 *
 * # Migration réelle
 * npx tsx scripts/migrate-life-insurance.ts --user demo --apply
 *
 * # Tous les utilisateurs
 * npx tsx scripts/migrate-life-insurance.ts --all --apply
 * ```
 *
 * ## Pourquoi une migration
 *
 * La table AV alimentait le patrimoine net par le cash, en parallèle du
 * journal : un support saisi des deux côtés comptait deux fois, et une UC
 * actions se retrouvait rangée dans « Cash ». Depuis que `getExplicitCashTotalEur`
 * n'additionne plus l'AV, les supports restés dans la table ne sont plus comptés
 * du tout — cette migration les fait entrer au journal, où ils comptent une fois
 * et une seule.
 *
 * ## Sécurité
 *
 * Mode « à blanc » par défaut : il faut `--apply` pour écrire. La migration est
 * idempotente — un support déjà rapproché d'une position du journal n'est jamais
 * recréé — donc relançable sans risque de doublon. Le contrat lui-même n'est
 * jamais supprimé : il porte la date d'ouverture, dont dépend l'antériorité
 * fiscale des huit ans.
 */

import { createPrismaClient } from "@/app/lib/prisma";
import {
  auditLifeInsurance,
  migrateLifeInsuranceToLedger,
} from "@/app/lib/life-insurance/migrate-to-ledger";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const eur = (v: string) =>
  `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`;

async function main(): Promise<void> {
  const apply = has("apply");
  const all = has("all");
  const username = arg("user");

  if (!all && !username) {
    throw new Error("--user <identifiant> requis, ou --all pour tous");
  }

  const prisma = createPrismaClient();
  try {
    const users = all
      ? await prisma.user.findMany({ select: { id: true, username: true } })
      : await prisma.user.findMany({
          where: { username: username! },
          select: { id: true, username: true },
        });

    if (users.length === 0) throw new Error("Aucun utilisateur trouvé");

    console.log(
      apply
        ? "\n⚠ MODE RÉEL — les écritures vont être créées."
        : "\nMode à blanc (aucune écriture). Ajoutez --apply pour migrer."
    );

    for (const u of users) {
      const audit = await auditLifeInsurance(u.id);
      if (audit.contracts.length === 0) {
        console.log(`\n▸ ${u.username} : aucun contrat d'assurance-vie.`);
        continue;
      }

      console.log(`\n▸ ${u.username}`);
      for (const c of audit.contracts) {
        console.log(
          `  ${c.insurer} (ouverture ${c.openDate?.slice(0, 10) ?? "—"})`
        );
        if (Number(c.cashEuro) > 0) {
          console.log(`    fonds euro du contrat : ${eur(c.cashEuro)}`);
        }
        for (const dp of c.duplicates) {
          console.log(
            `    doublon : « ${dp.tableName} » ↔ journal « ${dp.ledgerName} » — ${eur(dp.valueEur)}`
          );
        }
        for (const t of c.toMigrate) {
          console.log(`    à migrer : ${t.name} — ${eur(t.valueEur)}`);
        }
      }
      /*
        Ces trois blocs valent pour le compte entier, pas pour le dernier
        contrat affiché — `ledgerOnly` est ce qu'aucun contrat n'a revendiqué,
        et les deux totaux sont ceux de tous les contrats réunis. Ils étaient
        indentés comme les lignes de contrat, si bien que la liste « déjà au
        journal » semblait appartenir au contrat du dessus. C'est précisément
        la lecture qu'un opérateur fait juste avant de lancer `--apply`.
      */
      if (audit.ledgerOnly.length > 0) {
        console.log("\n  Positions AV déjà au journal, tous contrats confondus :");
        for (const l of audit.ledgerOnly) {
          console.log(`    · ${l.name} — ${eur(l.marketValueEur)}`);
        }
      }
      console.log(`\n  Total du compte — doublons à retirer : ${eur(audit.doubleCountedEur)}`);
      console.log(`  Total du compte — supports à migrer  : ${eur(audit.toMigrateEur)}`);

      const res = await migrateLifeInsuranceToLedger(u.id, { dryRun: !apply });
      console.log(
        `  → ${apply ? "créé" : "créerait"} ${res.created} position(s), ` +
          `${apply ? "retiré" : "retirerait"} ${res.duplicatesRemoved} doublon(s)`
      );
      for (const e of res.errors) console.log(`  ✗ ${e}`);
    }

    if (!apply) {
      console.log(
        "\nRien n'a été modifié. Relancez avec --apply pour appliquer."
      );
    } else {
      console.log(
        "\nTerminé. Vérifiez le patrimoine net et l'allocation par classe."
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
