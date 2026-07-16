import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { commitImportRows } from "@/app/lib/import/commit";
import type { ImportDraftRow } from "@/app/lib/import/map-rows";
import { AccountingError } from "@/app/lib/accounting";
import { recordPortfolioSnapshot } from "@/app/lib/portfolio/service";

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const body = await req.json();
    const platformId = String(body?.platformId || "");
    const rows = (body?.rows || []) as ImportDraftRow[];

    if (!platformId) {
      return NextResponse.json({ error: "Plateforme requise" }, { status: 400 });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Aucune ligne à importer" }, { status: 400 });
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: "Maximum 500 lignes par import" }, { status: 400 });
    }

    const result = await commitImportRows({ userId, platformId, rows });

    try {
      await recordPortfolioSnapshot(userId);
    } catch {
      /* non-blocking */
    }

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AccountingError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error("import commit", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur d'import" },
      { status: 500 }
    );
  }
}
