import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { parseFuturesCsv } from "@/app/lib/crypto/futures-csv";
import { applyFuturesImport } from "@/app/lib/crypto/futures-import-service";
import { FUTURES_IMPORT_EXCHANGES } from "@/app/lib/crypto/futures-constants";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  exchange: z.enum(FUTURES_IMPORT_EXCHANGES as unknown as [string, ...string[]]),
  csv: z.string().min(1, "Fichier vide"),
});

/**
 * POST /api/crypto/futures/import
 *
 * Relevé de trades Binance/Bybit/OKX. Chaque ligne est upsertée par
 * `exchangeTradeId` — importer deux fois le même relevé ne crée pas de
 * doublons, il met simplement à jour les mêmes positions.
 */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const { rows, skipped, errors: parseErrors } = parseFuturesCsv(
      parsed.data.csv,
      parsed.data.exchange as (typeof FUTURES_IMPORT_EXCHANGES)[number]
    );
    const result = await applyFuturesImport(
      userId,
      parsed.data.exchange as (typeof FUTURES_IMPORT_EXCHANGES)[number],
      rows
    );

    return NextResponse.json({
      ...result,
      rowsRead: rows.length,
      rowsSkipped: skipped,
      parseWarnings: parseErrors,
    });
  } catch (e) {
    console.error("[crypto/futures/import POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Import impossible") },
      { status: 500 }
    );
  }
}
