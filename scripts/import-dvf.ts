/**
 * Import des ventes DVF géolocalisées (Etalab), par département et millésime.
 *
 * ```
 * npx tsx scripts/import-dvf.ts --department 13 --year 2024
 * npx tsx scripts/import-dvf.ts --department 13 --year 2023,2024,2025
 * npx tsx scripts/import-dvf.ts --department 13 --year 2024 --file ./13.csv.gz
 *
 * # Fichier national (toutes communes de France), un seul millésime :
 * npx tsx scripts/import-dvf.ts --national-file ./full_2024.csv.gz --department 13,75,69 --year 2024
 * ```
 *
 * ## Traitement en flux
 *
 * Un département-millésime pèse plusieurs dizaines de mégaoctets décompressés,
 * un fichier national plusieurs gigaoctets. Le fichier est donc lu en flux —
 * disque/HTTPS → gunzip → lignes — sans jamais être chargé entier en mémoire.
 * Les lignes d'une même mutation étant contiguës dans les fichiers Etalab, le
 * tampon est vidé à chaque changement d'`id_mutation` : l'empreinte mémoire
 * reste celle d'une seule mutation (par département suivi, en mode national).
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
 *
 * ## Mode national
 *
 * Un fichier national mélange tous les départements de France ; on ne veut en
 * charger qu'une partie (`--department` est alors obligatoire, une exécution
 * "toute la France" prendrait des heures et des gigaoctets en base pour un
 * bénéfice nul si l'utilisateur n'a des biens que dans deux ou trois
 * départements). Chaque département demandé reçoit son propre `DvfImport`,
 * exactement comme s'il avait été téléchargé séparément — l'estimation en
 * aval ne voit aucune différence entre les deux modes.
 */

import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { basename } from "node:path";
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

/**
 * Trace de provenance stockée en base — le seul nom du fichier, jamais son
 * chemin complet : un chemin local contient souvent le nom d'utilisateur du
 * poste qui a lancé l'import (`C:\Users\<nom>\...`), qui n'a rien à faire
 * dans une table de référentiel partagée.
 */
function describeSource(url: string, localFile: string | null): string {
  return localFile ? `local:${basename(localFile)}` : url;
}

const DEPARTMENT_PATTERN = /^\d{2,3}[AB]?$/i;

type Args = {
  department: string[];
  years: number[];
  file: string | null;
  nationalFile: string | null;
};

function parseDepartments(raw: string): string[] {
  const list = raw
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter((d) => d.length > 0);
  if (list.length === 0) {
    throw new Error("--department requis (ex. 13 ou 13,75,69)");
  }
  const invalid = list.filter((d) => !DEPARTMENT_PATTERN.test(d));
  if (invalid.length > 0) {
    throw new Error(`Département(s) invalide(s) : ${invalid.join(", ")}`);
  }
  return list;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };

  const department = parseDepartments(get("department") ?? "");

  const yearsRaw = (get("year") ?? "").trim();
  const years = yearsRaw
    .split(",")
    .map((y) => Number(y.trim()))
    .filter((y) => Number.isInteger(y) && y >= 2014 && y <= 2100);
  if (years.length === 0) {
    throw new Error("--year requis (ex. 2024 ou 2023,2024,2025)");
  }

  const file = get("file");
  const nationalFile = get("national-file");

  if (file && nationalFile) {
    throw new Error("--file et --national-file sont mutuellement exclusifs");
  }
  if (nationalFile && years.length > 1) {
    throw new Error(
      "--national-file ne prend qu'un seul --year : un fichier national ne couvre qu'un millésime. Relancez une fois par fichier."
    );
  }
  if (file && department.length > 1) {
    throw new Error(
      "--file ne prend qu'un seul --department à la fois (il est déjà propre à ce département)"
    );
  }

  return { department, years, file, nationalFile };
}

/** Un flux gzip n'est décompressé que si le fichier local en est un. */
function isGzipPath(path: string): boolean {
  return /\.gz$/i.test(path);
}

/** Flux de lignes, depuis un fichier local (gzippé ou non) ou l'URL Etalab. */
async function openLineStream(
  url: string | null,
  localFile: string | null
): Promise<AsyncIterable<string>> {
  if (localFile) {
    const raw = createReadStream(localFile);
    const input = isGzipPath(localFile) ? raw.pipe(createGunzip()) : raw;
    return createInterface({ input, crlfDelay: Infinity });
  }

  const res = await fetch(url!);
  if (!res.ok) {
    throw new Error(`Téléchargement impossible (HTTP ${res.status}) — ${url}`);
  }
  if (!res.body) throw new Error("Réponse sans corps");
  const gunzip = createGunzip();
  Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(
    gunzip
  );
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

function emptyTotals(): Totals {
  return { rowsRead: 0, salesStored: 0, duplicates: 0, rejected: emptyRejects() };
}

function reportTotals(department: string, year: number, totals: Totals): void {
  const rejectedTotal = Object.values(totals.rejected).reduce((a, b) => a + b, 0);
  console.log(
    `  ✓ ${department} ${year} : ${totals.salesStored} ventes enregistrées`
  );
  if (totals.duplicates > 0) {
    console.log(
      `    ${totals.duplicates} déjà présentes (autre millésime) — ignorées`
    );
  }
  if (rejectedTotal > 0) {
    console.log(`    ${rejectedTotal} mutations écartées :`);
    for (const [reason, count] of Object.entries(totals.rejected)) {
      if (count > 0) console.log(`      ${reason.padEnd(24)} ${count}`);
    }
  }
}

function cellsToRow(cells: string[], indexOf: Record<string, number>): DvfRawRow {
  const at = (col: string): string => cells[indexOf[col]!] ?? "";
  return {
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
}

async function readValidatedHeader(
  iterator: AsyncIterator<string>,
  source: string
): Promise<Record<string, number>> {
  let headerLine: string | null = null;
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    if (next.value.trim() !== "") {
      headerLine = next.value;
      break;
    }
  }
  if (!headerLine) throw new Error(`Fichier vide — ${source}`);

  const headers = parseLine(headerLine, ",").map((h) => h.trim().toLowerCase());
  const missing = missingDvfColumns(headers);
  if (missing.length > 0) {
    throw new Error(
      `Colonnes absentes du fichier source : ${missing.join(", ")}.\n` +
        `En-tête reçu : ${headers.join(", ")}\n` +
        `Aucune donnée existante n'a été supprimée.`
    );
  }
  return Object.fromEntries(headers.map((h, i) => [h, i]));
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
  const lines = await openLineStream(localFile ? null : url, localFile);
  const iterator = lines[Symbol.asyncIterator]();
  const indexOf = await readValidatedHeader(iterator, localFile ?? url);

  // Source saine : on peut remplacer l'import précédent. La cascade emporte ses
  // ventes, ce qui rend l'opération rejouable sans jamais créer de doublon.
  await prisma.dvfImport.deleteMany({ where: { department, year } });
  const importRow = await prisma.dvfImport.create({
    data: {
      department,
      year,
      sourceUrl: describeSource(url, localFile),
      status: "RUNNING",
    },
  });

  const totals = emptyTotals();

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

      const row = cellsToRow(parseLine(line, ","), indexOf);
      totals.rowsRead++;

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

    reportTotals(department, year, totals);
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

/**
 * Importe un fichier national en n'en retenant que les départements demandés.
 *
 * Un `id_mutation` appartient toujours à un seul département (une vente ne
 * chevauche pas une frontière départementale), donc les rows de chaque
 * département suivi peuvent être bufferisées indépendamment, même si le
 * fichier entrelace les départements — ce qui n'arrive pas dans les exports
 * Etalab (triés par département) mais ne serait pas un problème si c'était
 * le cas.
 */
async function importNational(
  prisma: ReturnType<typeof createPrismaClient>,
  departments: string[],
  year: number,
  localFile: string
): Promise<void> {
  console.log(`\n▸ Fichier national ${localFile}, millésime ${year}`);
  console.log(`  départements retenus : ${departments.join(", ")}`);

  const lines = await openLineStream(null, localFile);
  const iterator = lines[Symbol.asyncIterator]();
  const indexOf = await readValidatedHeader(iterator, localFile);

  const wanted = new Set(departments);

  // En-tête validé : on peut remplacer les imports précédents des départements
  // demandés. Un département non demandé n'est jamais touché.
  const importRows = new Map<string, { id: string; totals: Totals }>();
  for (const department of departments) {
    await prisma.dvfImport.deleteMany({ where: { department, year } });
    const row = await prisma.dvfImport.create({
      data: {
        department,
        year,
        sourceUrl: describeSource("", localFile),
        status: "RUNNING",
      },
    });
    importRows.set(department, { id: row.id, totals: emptyTotals() });
  }

  type DeptState = {
    currentId: string | null;
    buffer: DvfRawRow[];
    pending: AggregatedSale[];
  };
  const states = new Map<string, DeptState>();
  const stateFor = (dept: string): DeptState => {
    let s = states.get(dept);
    if (!s) {
      s = { currentId: null, buffer: [], pending: [] };
      states.set(dept, s);
    }
    return s;
  };

  const flushPending = async (dept: string, force: boolean) => {
    const s = stateFor(dept);
    if (s.pending.length === 0) return;
    if (!force && s.pending.length < INSERT_BATCH) return;
    const entry = importRows.get(dept)!;
    const written = await prisma.dvfSale.createMany({
      data: s.pending.map((sale) => ({ ...sale, importId: entry.id })),
      skipDuplicates: true,
    });
    entry.totals.salesStored += written.count;
    entry.totals.duplicates += s.pending.length - written.count;
    s.pending = [];
  };

  const closeMutation = async (dept: string) => {
    const s = stateFor(dept);
    if (s.buffer.length === 0) return;
    const entry = importRows.get(dept)!;
    const sale = aggregateMutation(s.buffer, entry.totals.rejected);
    if (sale) s.pending.push(sale);
    s.buffer = [];
    await flushPending(dept, false);
  };

  let rowsReadGlobal = 0;

  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const line = next.value;
      if (line.trim() === "") continue;

      const row = cellsToRow(parseLine(line, ","), indexOf);
      const dept = row.code_departement.trim().toUpperCase();
      if (!wanted.has(dept)) continue;

      rowsReadGlobal++;
      const entry = importRows.get(dept)!;
      entry.totals.rowsRead++;

      const id = row.id_mutation.trim();
      if (!id) continue;

      const s = stateFor(dept);
      if (s.currentId !== null && id !== s.currentId) {
        await closeMutation(dept);
      }
      s.currentId = id;
      s.buffer.push(row);

      if (rowsReadGlobal % 200_000 === 0) {
        process.stdout.write(`\r  lignes lues (retenues) ${rowsReadGlobal}   `);
      }
    }

    for (const dept of departments) {
      await closeMutation(dept);
      await flushPending(dept, true);
    }
    process.stdout.write("\n");

    for (const dept of departments) {
      const entry = importRows.get(dept)!;
      const rejectedTotal = Object.values(entry.totals.rejected).reduce(
        (a, b) => a + b,
        0
      );
      await prisma.dvfImport.update({
        where: { id: entry.id },
        data: {
          status: "DONE",
          rowsRead: entry.totals.rowsRead,
          salesStored: entry.totals.salesStored,
          rejected: rejectedTotal,
          rejectReasons: {
            ...entry.totals.rejected,
            deja_presentes: entry.totals.duplicates,
          },
          finishedAt: new Date(),
        },
      });
      reportTotals(dept, year, entry.totals);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    for (const entry of importRows.values()) {
      await prisma.dvfImport.update({
        where: { id: entry.id },
        data: { status: "ERROR", error: message, finishedAt: new Date() },
      });
    }
    throw e;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient();

  try {
    if (args.nationalFile) {
      await importNational(prisma, args.department, args.years[0]!, args.nationalFile);
    } else {
      for (const year of args.years) {
        await importOne(prisma, args.department[0]!, year, args.file);
      }
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
