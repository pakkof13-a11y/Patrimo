import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { importCsv } from "@/app/lib/import/import-csv";
import { IMPORT_FORMATS } from "@/app/lib/import/presets";
import type { ColumnMapping } from "@/app/lib/import/types";
import { listAdapters } from "@/app/lib/import/adapters/registry";

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const body = await req.json();
    const csvText = String(body?.csvText || "");
    const formatId = String(body?.formatId || "auto");
    const delimiter = body?.delimiter as string | undefined;
    const columnMap = (body?.columnMap || null) as ColumnMapping | null;

    if (!csvText.trim()) {
      return NextResponse.json({ error: "Fichier CSV vide" }, { status: 400 });
    }
    if (csvText.length > 2_000_000) {
      return NextResponse.json({ error: "Fichier trop volumineux (max ~2 Mo)" }, { status: 400 });
    }

    const knownIds = new Set([
      ...IMPORT_FORMATS.map((f) => f.id),
      ...listAdapters().map((a) => a.meta.id),
      "auto",
    ]);
    if (!knownIds.has(formatId)) {
      return NextResponse.json({ error: "Format inconnu" }, { status: 400 });
    }

    const result = importCsv(csvText, {
      formatId: formatId as "auto",
      delimiter,
      columnMap: columnMap || undefined,
    });

    const rows = result.drafts;
    const okCount = rows.filter((r) => r.status === "ok").length;
    const warnCount = rows.filter((r) => r.status === "warning").length;
    const errCount = rows.filter((r) => r.status === "error").length;

    return NextResponse.json({
      headers: result.csv.headers,
      delimiter: result.csv.delimiter,
      formatId: result.formatId,
      detectedFormatId: result.detectedFormatId,
      formatLabel: result.formatLabel,
      columnMap: result.columnMap,
      confidence: result.confidence,
      needsManualMapping: result.needsManualMapping,
      transactions: result.transactions.slice(0, 100).map((t) => ({
        date: t.date.toISOString(),
        type: t.type,
        ticker: t.ticker,
        quantity: t.quantity,
        price: t.price,
        fees: t.fees ?? null,
      })),
      adapterRanking: result.adapterRanking.slice(0, 8),
      warnings: result.warnings.slice(0, 50),
      rows: rows.slice(0, 500),
      truncated: rows.length > 500,
      totalRows: rows.length,
      stats: { ok: okCount, warning: warnCount, error: errCount },
    });
  } catch (e) {
    console.error("import preview", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur d'analyse CSV" },
      { status: 500 }
    );
  }
}
