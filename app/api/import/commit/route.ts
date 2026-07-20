import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { commitImportRows } from "@/app/lib/import/commit";
import { importCsv } from "@/app/lib/import/import-csv";
import {
  IMPORT_COMMIT_MAX_ROWS,
  IMPORT_MAX_CSV_CHARS,
} from "@/app/lib/import/limits";
import type { ImportDraftRow } from "@/app/lib/import/map-rows";
import type { ColumnMapping } from "@/app/lib/import/types";
import { AccountingError } from "@/app/lib/accounting";
import { recordPortfolioSnapshot } from "@/app/lib/portfolio/service";

/**
 * POST /api/import/commit
 *
 * Modes :
 * 1. **csvText** (recommandé) — re-parse le fichier entier côté serveur.
 *    L’aperçu UI peut être tronqué à 500 lignes sans limiter l’import.
 *    `rowSelection` optionnel : { [lineNumber]: boolean } pour les cases
 *    cochées/décochées dans l’aperçu ; les lignes hors aperçu restent sélectionnées
 *    si valides.
 * 2. **rows** (legacy) — envoi direct des drafts (petits fichiers uniquement).
 */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const platformId = String(body?.platformId || "");
    if (!platformId) {
      return NextResponse.json({ error: "Plateforme requise" }, { status: 400 });
    }

    const csvText =
      typeof body?.csvText === "string" ? (body.csvText as string) : "";
    let rows: ImportDraftRow[] = [];

    if (csvText.trim()) {
      if (csvText.length > IMPORT_MAX_CSV_CHARS) {
        return NextResponse.json(
          {
            error: `Fichier trop volumineux (max ~${Math.round(IMPORT_MAX_CSV_CHARS / 1_000_000)} Mo)`,
          },
          { status: 400 }
        );
      }

      const formatId = String(body?.formatId || "auto");
      const delimiter = body?.delimiter as string | undefined;
      const columnMap = (body?.columnMap || null) as ColumnMapping | null;

      const parsed = importCsv(csvText, {
        formatId: formatId as "auto",
        delimiter,
        columnMap: columnMap || undefined,
      });

      if (parsed.drafts.length > IMPORT_COMMIT_MAX_ROWS) {
        return NextResponse.json(
          {
            error: `Trop de lignes (${parsed.drafts.length}). Maximum ${IMPORT_COMMIT_MAX_ROWS} par import.`,
          },
          { status: 400 }
        );
      }

      // Sélections UI (aperçu) : map line → selected
      const selectionRaw = body?.rowSelection as
        | Record<string, boolean>
        | undefined;
      const selection = new Map<number, boolean>();
      if (selectionRaw && typeof selectionRaw === "object") {
        for (const [k, v] of Object.entries(selectionRaw)) {
          const line = Number(k);
          if (Number.isFinite(line)) selection.set(line, Boolean(v));
        }
      }

      rows = parsed.drafts.map((d) => {
        const isError = d.status === "error";
        const blockedType =
          d.type === "TRANSFERT_CASH" || d.type === "TRANSFERT_TITRE";
        let selected = !isError && !blockedType;
        if (selection.has(d.line)) {
          selected = Boolean(selection.get(d.line)) && !isError && !blockedType;
        }
        return { ...d, selected };
      });
    } else {
      rows = (body?.rows || []) as ImportDraftRow[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json(
          { error: "Aucune ligne à importer (csvText ou rows requis)" },
          { status: 400 }
        );
      }
      if (rows.length > IMPORT_COMMIT_MAX_ROWS) {
        return NextResponse.json(
          {
            error: `Maximum ${IMPORT_COMMIT_MAX_ROWS} lignes par import`,
          },
          { status: 400 }
        );
      }
    }

    const acceptSuspectLines = Array.isArray(body?.acceptSuspectLines)
      ? (body.acceptSuspectLines as unknown[])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : [];

    const result = await commitImportRows({
      userId,
      platformId,
      rows,
      skipDuplicates: body?.skipDuplicates !== false,
      requireSuspectDecision: true,
      acceptSuspectLines,
    });

    try {
      await recordPortfolioSnapshot(userId);
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({
      ...result,
      totalDrafts: rows.length,
    });
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: 400 }
      );
    }
    console.error("import commit", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur d'import" },
      { status: 500 }
    );
  }
}
