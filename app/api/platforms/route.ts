import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { platformSchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { getPlatformCashBalances } from "@/app/lib/portfolio/service";
import { PLATFORM_PRESETS } from "@/app/lib/platforms/presets";
import { findOrCreatePlatform } from "@/app/lib/platforms/upsert";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const platforms = await getPlatformCashBalances(userId, user?.baseCurrency || "EUR");
  return NextResponse.json({ platforms, presets: PLATFORM_PRESETS });
}

/**
 * POST /api/platforms
 * Body: platformSchema (+ optionnel `upsert: true` pour find-or-create race-safe).
 * Mode upsert (défaut pour création contextuelle) : ne renvoie jamais 409,
 * retourne `{ platform, created }`.
 * Mode strict (`upsert: false`) : 409 si le nom existe déjà.
 */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  /** Défaut true : création contextuelle (transaction / import). */
  const upsert =
    raw.upsert === false || raw.upsert === "false" ? false : true;

  const parsed = platformSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const name = parsed.data.name.trim();

  if (!upsert) {
    const existing = await prisma.platform.findFirst({
      where: { userId, name: { equals: name, mode: "insensitive" } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Cette plateforme existe déjà dans votre liste" },
        { status: 409 }
      );
    }
  }

  try {
    const { platform, created } = await findOrCreatePlatform(userId, {
      name,
      type: parsed.data.type,
      subtype: parsed.data.subtype,
      logoKey: parsed.data.logoKey,
      logoUrl: parsed.data.logoUrl,
      walletAddress: parsed.data.walletAddress,
      walletApiKey: parsed.data.walletApiKey,
      notes: parsed.data.notes,
    });
    return NextResponse.json(
      { platform, created },
      { status: created ? 201 : 200 }
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Dernière ligne de défense race — re-upsert
      try {
        const again = await findOrCreatePlatform(userId, {
          name,
          type: parsed.data.type,
          subtype: parsed.data.subtype,
          logoKey: parsed.data.logoKey,
          logoUrl: parsed.data.logoUrl,
          walletAddress: parsed.data.walletAddress,
          walletApiKey: parsed.data.walletApiKey,
          notes: parsed.data.notes,
        });
        return NextResponse.json(
          { platform: again.platform, created: again.created },
          { status: again.created ? 201 : 200 }
        );
      } catch {
        /* fallthrough */
      }
      return NextResponse.json(
        { error: "Cette plateforme existe déjà dans votre liste" },
        { status: 409 }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[platforms POST]", msg);
    // Message client non verbeux mais actionnable (pas de stack / SQL)
    const schemaLag = /walletApiKey|column .* does not exist|Unknown arg/i.test(
      msg
    );
    return NextResponse.json(
      {
        error: schemaLag
          ? "Schéma base obsolète — migration plateformes requise. Réessayez après déploiement."
          : "Erreur serveur, veuillez réessayer",
        code: schemaLag ? "SCHEMA_LAG" : "SERVER_ERROR",
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const existing = await prisma.platform.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = platformSchema.partial().safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.PlatformUpdateInput = {};
  if (f.name !== undefined) data.name = f.name.trim();
  if (f.type !== undefined) data.type = f.type;
  if (f.subtype !== undefined) data.subtype = f.subtype;
  if (f.logoKey !== undefined) data.logoKey = f.logoKey;
  if (f.logoUrl !== undefined) data.logoUrl = f.logoUrl || null;
  if (f.walletAddress !== undefined) data.walletAddress = f.walletAddress;
  // walletApiKey ajouté au schéma — cast tant que le client Prisma n’est pas regénéré
  if (f.walletApiKey !== undefined) {
    (data as Record<string, unknown>).walletApiKey = f.walletApiKey;
  }
  if (f.notes !== undefined) data.notes = f.notes;

  try {
    const write = await prisma.platform.updateMany({
      where: { id, userId },
      data,
    });
    if (write.count === 0) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }
    const platform = await prisma.platform.findFirst({ where: { id, userId } });
    return NextResponse.json({ platform });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Cette plateforme existe déjà dans votre liste" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Erreur serveur, veuillez réessayer" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/platforms?id=…
 * - Sans force : refuse si actifs/txs liés (409 + counts)
 * - force=1 : cascade (txs, assets, quotes, on-chain…) puis plateforme
 */
export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const force =
    url.searchParams.get("force") === "1" ||
    url.searchParams.get("force") === "true";
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const existing = await prisma.platform.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const [assetCount, txCount] = await Promise.all([
    prisma.asset.count({ where: { platformId: id, userId } }),
    prisma.transaction.count({
      where: {
        userId,
        OR: [{ platformId: id }, { toPlatformId: id }],
      },
    }),
  ]);

  if (!force && (assetCount > 0 || txCount > 0)) {
    return NextResponse.json(
      {
        error: `La plateforme « ${existing.name} » a ${assetCount} actif(s) et ${txCount} transaction(s) liés.`,
        code: "HAS_DEPENDENCIES",
        assetCount,
        txCount,
        name: existing.name,
      },
      { status: 409 }
    );
  }

  try {
    if (force) {
      // Asset.platform onDelete:Restrict + Transaction.assetId Restrict :
      // il faut supprimer TOUTES les txs qui pointent vers les actifs de la
      // plateforme (même si tx.platformId est ailleurs), puis les actifs.
      const assetIds = (
        await prisma.asset.findMany({
          where: { platformId: id, userId },
          select: { id: true },
        })
      ).map((a) => a.id);

      let deletedTxs = 0;
      await prisma.$transaction(
        async (tx) => {
          if (assetIds.length > 0) {
            await tx.priceHistory.deleteMany({
              where: { assetId: { in: assetIds } },
            });
            await tx.priceQuote.deleteMany({
              where: { assetId: { in: assetIds } },
            });
          }

          // Txs liées à la plateforme OU aux actifs « home » de la plateforme
          const delTx = await tx.transaction.deleteMany({
            where: {
              userId,
              OR: [
                { platformId: id },
                { toPlatformId: id },
                ...(assetIds.length > 0
                  ? [{ assetId: { in: assetIds } }]
                  : []),
              ],
            },
          });
          deletedTxs = delTx.count;

          // On-chain Solana (Cascade côté schema, mais on nettoie explicitement)
          await tx.blockchainOnchainTx.deleteMany({
            where: { platformId: id, userId },
          });

          await tx.asset.deleteMany({ where: { platformId: id, userId } });
          await tx.platform.deleteMany({ where: { id, userId } });
        },
        { timeout: 60_000 }
      );

      try {
        const { invalidateLedgerCache } = await import(
          "@/app/lib/portfolio/ledger-cache"
        );
        invalidateLedgerCache(userId);
      } catch {
        /* ignore */
      }
      return NextResponse.json({
        ok: true,
        force: true,
        deleted: {
          assets: assetCount,
          transactions: deletedTxs || txCount,
          name: existing.name,
        },
      });
    }

    await prisma.platform.deleteMany({ where: { id, userId } });
    return NextResponse.json({ ok: true, force: false });
  } catch (e) {
    console.error("[platforms DELETE]", e);
    const msg = e instanceof Error ? e.message : "Erreur serveur";
    // Prisma FK / timeout : message utile côté UI
    const friendly =
      /Foreign key|Restrict|P2003/i.test(msg)
        ? `Impossible de supprimer « ${existing.name} » : des données liées restent bloquantes. Réessayez avec force, ou contactez le support.`
        : /timeout|Timed out/i.test(msg)
          ? "Suppression trop longue — réessayez (beaucoup de transactions)."
          : "Erreur serveur lors de la suppression, veuillez réessayer";
    return NextResponse.json(
      {
        error: friendly,
        detail: process.env.NODE_ENV === "development" ? msg : undefined,
      },
      { status: 500 }
    );
  }
}
