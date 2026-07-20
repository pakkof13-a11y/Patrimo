import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { analyzeImportDuplicates } from "@/app/lib/import/commit";
import { importCsv } from "@/app/lib/import/import-csv";
import {
  IMPORT_COMMIT_MAX_ROWS,
  IMPORT_MAX_CSV_CHARS,
} from "@/app/lib/import/limits";
import type { ImportDraftRow } from "@/app/lib/import/map-rows";
import type { ColumnMapping } from "@/app/lib/import/types";
import { AccountingError } from "@/app/lib/accounting";

/**
 * POST /api/import/analyze
 * Classe les lignes (créables / doublons stricts / suspects) sans écrire en base.
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
          { error: "Fichier trop volumineux" },
          { status: 400 }
        );
      }
      const parsed = importCsv(csvText, {
        formatId: String(body?.formatId || "auto") as "auto",
        delimiter: body?.delimiter as string | undefined,
        columnMap: (body?.columnMap || undefined) as ColumnMapping | undefined,
      });
      if (parsed.drafts.length > IMPORT_COMMIT_MAX_ROWS) {
        return NextResponse.json(
          {
            error: `Trop de lignes (${parsed.drafts.length}). Max ${IMPORT_COMMIT_MAX_ROWS}.`,
          },
          { status: 400 }
        );
      }
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
        const blocked =
          d.type === "TRANSFERT_CASH" || d.type === "TRANSFERT_TITRE";
        let selected = !isError && !blocked;
        if (selection.has(d.line)) {
          selected = Boolean(selection.get(d.line)) && !isError && !blocked;
        }
        return { ...d, selected };
      });
    } else {
      rows = (body?.rows || []) as ImportDraftRow[];
    }

    const analysis = await analyzeImportDuplicates({
      userId,
      platformId,
      rows,
    });

    return NextResponse.json({
      totalSelected: analysis.totalSelected,
      toCreateCount: analysis.toCreate.length,
      strictCount: analysis.strictSkipped.length,
      suspectCount: analysis.suspects.length,
      suspects: analysis.suspects.map((s) => ({
        line: s.line,
        deltaMs: s.deltaMs,
        draft: {
          line: s.draft.line,
          type: s.draft.type,
          occurredAt: s.draft.occurredAt,
          ticker: s.draft.ticker,
          name: s.draft.name,
          quantity: s.draft.quantity,
          unitPrice: s.draft.unitPrice,
          fees: s.draft.fees,
          currency: s.draft.currency,
          cashAmount: s.draft.cashAmount,
          notes: s.draft.notes,
        },
        existing: s.existing,
      })),
    });
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: 400 }
      );
    }
    console.error("import analyze", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur d'analyse" },
      { status: 500 }
    );
  }
}
