import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { mergePlatforms } from "@/app/lib/platforms/upsert";
import { validationErrorResponse } from "@/app/lib/api/validation";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";

const mergeSchema = z.object({
  sourceId: z.string().min(1, "sourceId requis"),
  targetId: z.string().min(1, "targetId requis"),
});

/** POST /api/platforms/merge — fusionne source → target */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const result = await mergePlatforms(
      userId,
      parsed.data.sourceId,
      parsed.data.targetId
    );
    invalidateLedgerCache(userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Échec de la fusion";
    const status =
      /introuvable|elle-même/i.test(message) ? 400 : 500;
    if (status === 500) console.error("[platforms/merge]", e);
    return NextResponse.json({ error: message }, { status });
  }
}
