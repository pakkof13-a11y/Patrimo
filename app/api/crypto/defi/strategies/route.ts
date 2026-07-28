import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  createStrategy,
  listStrategies,
} from "@/app/lib/crypto/defi-strategy-service";
import { DefiInputError } from "@/app/lib/crypto/defi-manual-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET — liste des stratégies de l'utilisateur. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const strategies = await listStrategies(userId);
    return NextResponse.json(
      {
        strategies: strategies.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[crypto/defi/strategies GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des stratégies") },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** POST — crée une stratégie. */
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const strategy = await createStrategy(userId, parsed.data);
    return NextResponse.json(
      {
        ...strategy,
        createdAt: strategy.createdAt.toISOString(),
        updatedAt: strategy.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof DefiInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/strategies POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création de la stratégie impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
