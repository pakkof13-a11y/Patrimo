/**
 * Import des ventes DVF géolocalisées (Etalab), par département et millésime.
 *
 * ```
 * npx tsx scripts/import-dvf.ts --department 13 --year 2024
 * npx tsx scripts/import-dvf.ts --department 13 --year 2023,2024,2025
 * npx tsx scripts/import-dvf.ts --department 13 --year 2024 --file ./13.csv.gz
 * ```
 *
 * ## Traitement en flux
 *
 * Un département-millésime pèse plusieurs dizaines de mégaoctets décompressés.
 * Le fichier est donc lu en flux — HTTPS → gunzip → lignes — sans jamais être
 * chargé entier en mémoire. Les lignes d'une même mutation étant contiguës dans
 * les fichiers Etalab, le tampon est vidé à chaque changement d'`id_mutation` :
 * l'empreinte mémoire reste celle d'une seule mutation.
 *
 * ## En-têtes validés, pas devinés
 *
 * Les colonnes sont résolues **par nom**. Si l'une manque, le script s'arrête
 * en la nommant plutôt que de mapper par position : un décalage silencieux
 * produirait des estimations fausses qu'aucun test ne rattraperait.
 *
 * ## Rejouable
 *
 * `DvfImport` est unique sur (département, millésime). Relancer un import
 * supprime les ventes du précédent — en cascade — puis réinsère. Aucun doublon
 * possible, et un import interrompu se reprend simplement en le relançant.
 */

import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createPrismaClient } from "@/app/lib/prisma";
import { parseLine } from "@/app/lib/import/csv-parse";
import {
  aggregateMutation,
  missingDvfColumns,
  type AggregatedSale,
  type DvfRawRow,
  type RejectReason,
} from "@/app/lib/real-estate/dvf-aggregate";

const BASE_URL = "https://files.data.gouv.fr/geo-dvf/latest/csv";

/** Lignes insérées par lot — compromis mémoire / nombre d'allers-retours. */
const INSERT_BATCH = 2000;

function sourceUrl(department: string, year: number): string {
  return `${BASE_URL}/${year}/departements/${department}.csv.gz`;
}

type Args = {
  department: string;
  years: number[];
  file: string | null;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };

  const department = (get("department") ?? "").trim();
  if (!/^\d{2,3}[AB]?$/i.test(department)) {
    throw new Error(
      "--department requis (ex. 13, 2A, 974)"
    );
  }

  const yearsRaw = (get("year") ?? "").trim();
  const years = yearsRaw
    .split(",")
    .map((y) => Number(y.trim()))
    .filter((y) => Number.isInteger(y) && y >= 2014 && y <= 2100);
  if (years.length === 0) {
    throw new Error("--year requis (ex. 2024 ou 2023,2024,2025)");
  }

  return { department: department.toUpperCase(), years, file: get("file") };
}

/** Flux de lignes, depuis un fichier local ou l'URL Etalab. */
async function openLineStream(
  url: string,
  localFile: string | null
): Promise<AsyncIterable<string>> {
  const gunzip = createGunzip();

  if (localFile) {
    createReadStream(localFile).pipe(gunzip);
  } else {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Téléchargement impossible (HTTP ${res.status}) — ${url}`);
    }
    if (!res.body) throw new Error("Réponse sans corps");
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(
      gunzip
    );
  }

  return createInterface({ input: gunzip, crlfDelay: Infinity });
}

type Totals = {
  rowsRead: number;
  salesStored: number;
  /** Mutations déjà connues d'un autre millésime — ignorées, pas réécrites. */
  duplicates: number;
  rejected: Record<RejectReason, number>;
};

function emptyRejects(): Record<RejectReason, number> {
  return {
    nature_non_vente: 0,
    aucun_local_habitation: 0,
    types_melanges: 0,
    surface_absente: 0,
    valeur_absente: 0,
    coordonnees_absentes: 0,
    prix_m2_aberrant: 0,
    date_invalide: 0,
  };
}

async function importOne(
  prisma: ReturnType<typeof createPrismaClient>,
  department: string,
  year: number,
  localFile: string | null
): Promise<Totals> {
  const url = sourceUrl(department, year);
  console.log(`\n▸ Département ${department}, millésime ${year}`);
  console.log(`  source : ${localFile ?? url}`);

  // La source est ouverte et son en-tête validé AVANT toute suppression.
  //
  // Purger d'abord paraissait plus simple, mais faisait perdre des données
  // déjà chargées dès que la source était injoignable ou malformée : l'ancien
  // millésime disparaissait et le nouveau n'arrivait jamais. Les deux échecs
  // les plus probables — réseau et colonnes inattendues — se produisent
  // maintenant alors que la base est encore intacte.
  const lines = await openLineStream(url, localFile);
  const iterator = lines[Symbol.asyncIterator]();

  let headerLine: string | null = null;
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    if (next.value.trim() !== "") {
      headerLine = next.value;
      break;
    }
  }
  if (!headerLine) {
    throw new Error(`Fichier vide — ${localFile ?? url}`);
  }

  const headers = parseLine(headerLine, ",").map((h) => h.trim().toLowerCase());
  const missing = missingDvfColumns(headers);
  if (missing.length > 0) {
    throw new Error(
      `Colonnes absentes du fichier source : ${missing.join(", ")}.\n` +
        `En-tête reçu : ${headers.join(", ")}\n` +
        `Aucune donnée existante n'a été supprimée.`
    );
  }
  const indexOf: Record<string, number> = Object.fromEntries(
    headers.map((h, i) => [h, i])
  );

  // Source saine : on peut remplacer l'import précédent. La cascade emporte ses
  // ventes, ce qui rend l'opération rejouable sans jamais créer de doublon.
  await prisma.dvfImport.deleteMany({ where: { department, year } });
  const importRow = await prisma.dvfImport.create({
    data: { department, year, sourceUrl: url, status: "RUNNING" },
  });

  const totals: Totals = {
    rowsRead: 0,
    salesStored: 0,
    duplicates: 0,
    rejected: emptyRejects(),
  };

  try {
    let currentId: string | null = null;
    let buffer: DvfRawRow[] = [];
    let pending: AggregatedSale[] = [];

    const flushPending = async (force: boolean) => {
      if (pending.length === 0) return;
      if (!force && pending.length < INSERT_BATCH) return;
      // `createMany` rend le nombre de lignes réellement écrites : compter
      // `pending.length` mentirait dès qu'une mutation est déjà présente
      // (millésimes qui se recouvrent), et le rapport d'import annoncerait des
      // ventes qui n'existent pas.
      const written = await prisma.dvfSale.createMany({
        data: pending.map((s) => ({ ...s, importId: importRow.id })),
        skipDuplicates: true,
      });
      totals.salesStored += written.count;
      totals.duplicates += pending.length - written.count;
      pending = [];
      process.stdout.write(
        `\r  lignes lues ${totals.rowsRead} · ventes ${totals.salesStored}   `
      );
    };

    const closeMutation = async () => {
      if (buffer.length === 0) return;
      const sale = aggregateMutation(buffer, totals.rejected);
      if (sale) pending.push(sale);
      buffer = [];
      await flushPending(false);
    };

    // L'en-tête a déjà été consommé plus haut ; on reprend le flux où il en est.
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const line = next.value;
      if (line.trim() === "") continue;

      const cells = parseLine(line, ",");
      totals.rowsRead++;

      const at = (col: string): string => cells[indexOf[col]!] ?? "";
      const row: DvfRawRow = {
        id_mutation: at("id_mutation"),
        date_mutation: at("date_mutation"),
        nature_mutation: at("nature_mutation"),
        valeur_fonciere: at("valeur_fonciere"),
        code_postal: at("code_postal"),
        code_commune: at("code_commune"),
        nom_commune: at("nom_commune"),
        code_departement: at("code_departement"),
        code_type_local: at("code_type_local"),
        type_local: at("type_local"),
        surface_reelle_bati: at("surface_reelle_bati"),
        nombre_pieces_principales: at("nombre_pieces_principales"),
        surface_terrain: at("surface_terrain"),
        longitude: at("longitude"),
        latitude: at("latitude"),
      };

      const id = row.id_mutation.trim();
      if (!id) continue;

      if (currentId !== null && id !== currentId) {
        await closeMutation();
      }
      currentId = id;
      buffer.push(row);
    }

    await closeMutation();
    await flushPending(true);
    process.stdout.write("\n");

    const rejectedTotal = Object.values(totals.rejected).reduce(
      (a, b) => a + b,
      0
    );
    await prisma.dvfImport.update({
      where: { id: importRow.id },
      data: {
        status: "DONE",
        rowsRead: totals.rowsRead,
        salesStored: totals.salesStored,
        rejected: rejectedTotal,
        rejectReasons: { ...totals.rejected, deja_presentes: totals.duplicates },
        finishedAt: new Date(),
      },
    });

    console.log(`  ✓ ${totals.salesStored} ventes enregistrées`);
    if (totals.duplicates > 0) {
      console.log(
        `    ${totals.duplicates} déjà présentes (autre millésime) — ignorées`
      );
    }
    console.log(`    ${rejectedTotal} mutations écartées :`);
    for (const [reason, count] of Object.entries(totals.rejected)) {
      if (count > 0) console.log(`      ${reason.padEnd(24)} ${count}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.dvfImport.update({
      where: { id: importRow.id },
      data: { status: "ERROR", error: message, finishedAt: new Date() },
    });
    throw e;
  }

  return totals;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient();

  try {
    for (const year of args.years) {
      await importOne(prisma, args.department, year, args.file);
    }
    console.log("\nTerminé.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
