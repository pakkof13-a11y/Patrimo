import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { syncDefiPositions } from "@/app/lib/crypto/defi-sync";
import {
  listSyncCursors,
  updateSyncCursor,
} from "@/app/lib/crypto/defi-position-service";

export const dynamic = "force-dynamic";

const syncSchema = z.object({
  platformId: z.string().min(1, "Plateforme requise"),
  /**
   * `ZERION` est le seul fournisseur implémenté (cf. `defi-sync.ts`). Les autres
   * ont leur place dans `DefiSyncCursor` mais pas encore d'implémentation :
   * les accepter ici renverrait un succès pour une synchronisation qui n'a rien
   * fait. Limite V1 documentée dans `docs/defi-backend-v1.md`.
   */
  provider: z.literal("ZERION").optional(),
});

/**
 * POST /api/crypto/defi/sync
 *
 * Synchronise les positions DeFi d'un wallet. Un wallet **est** une `Platform`
 * dans ce dépôt (`type = BLOCKCHAIN`, champ `walletAddress`) — cf. D4 de la note
 * de décision.
 *
 * Le curseur est mis à jour dans tous les cas, succès comme échec :
 * `lastSuccessAt` reste alors en arrière et rend visible une synchronisation qui
 * échoue depuis des jours. Sans cette distinction, une panne de fournisseur
 * passerait pour un portefeuille vide.
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

  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }
  const provider = parsed.data.provider ?? "ZERION";

  const platform = await prisma.platform.findFirst({
    where: { id: parsed.data.platformId, userId },
    select: { id: true, walletAddress: true, walletApiKey: true, name: true },
  });
  if (!platform) {
    return NextResponse.json({ error: "Plateforme introuvable" }, { status: 404 });
  }
  if (!platform.walletAddress) {
    return NextResponse.json(
      {
        error: `${platform.name} n'a pas d'adresse de wallet enregistrée — renseignez-la avant de synchroniser.`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await syncDefiPositions(
      userId,
      platform.id,
      platform.walletAddress,
      platform.walletApiKey
    );

    await updateSyncCursor(userId, provider, {
      platformId: platform.id,
      sourceRef: platform.walletAddress,
      success: result.errors === 0,
      // Une synchronisation partiellement en échec n'est pas un succès : le
      // détail des erreurs est conservé pour qu'un wallet à moitié importé ne
      // soit pas pris pour un wallet complet.
      lastError:
        result.errors > 0
          ? `${result.errors} position(s) en erreur sur ${result.positionsSeen}`
          : null,
      importedCount: result.assetsTouched,
      updatedCount: result.txsCreated,
      ignoredCount: Math.max(result.positionsSeen - result.assetsTouched, 0),
    });

    return NextResponse.json(result);
  } catch (e) {
    // Timeout ou indisponibilité du fournisseur : le curseur enregistre
    // l'échec, l'historique déjà importé reste intact. Une position
    // temporairement absente n'est jamais supprimée (cf. `defi-sync.ts`).
    const message = clientErrorMessage(e, "Synchronisation DeFi impossible");
    await updateSyncCursor(userId, provider, {
      platformId: platform.id,
      sourceRef: platform.walletAddress,
      success: false,
      lastError: message.slice(0, 500),
    }).catch(() => {
      /* l'échec du curseur ne doit pas masquer l'échec réel de la sync */
    });

    console.error("[crypto/defi/sync POST]", e);
    return NextResponse.json({ error: message }, { status: clientErrorStatus(e) });
  }
}

/**
 * GET — état de santé des synchronisations DeFi.
 *
 * Exposé parce qu'une sync silencieusement en échec est le pire des cas : le
 * portefeuille paraît complet alors qu'il ne l'est plus.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const cursors = await listSyncCursors(userId);
    return NextResponse.json({
      cursors: cursors.map((c) => ({
        id: c.id,
        provider: c.provider,
        platformId: c.platformId,
        platformName: c.platform?.name ?? null,
        sourceRef: c.sourceRef,
        cursor: c.cursor,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
        lastSuccessAt: c.lastSuccessAt?.toISOString() ?? null,
        lastError: c.lastError,
        importedCount: c.importedCount,
        updatedCount: c.updatedCount,
        ignoredCount: c.ignoredCount,
        /** `true` quand la dernière tentative n'a pas abouti. */
        isFailing:
          c.lastError != null ||
          (c.lastSyncAt != null &&
            (c.lastSuccessAt == null || c.lastSuccessAt < c.lastSyncAt)),
      })),
    });
  } catch (e) {
    console.error("[crypto/defi/sync GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Chargement de l'état de synchronisation impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
