import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { platformSchema } from "@/app/lib/schemas";
import { getPlatformCashBalances } from "@/app/lib/portfolio/service";
import { findPreset, PLATFORM_PRESETS } from "@/app/lib/platforms/presets";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const platforms = await getPlatformCashBalances(userId, user?.baseCurrency || "EUR");
  return NextResponse.json({ platforms, presets: PLATFORM_PRESETS });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const parsed = platformSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const name = parsed.data.name.trim();

  // Pre-check unique (userId, name)
  const existing = await prisma.platform.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Cette plateforme existe déjà dans votre liste" },
      { status: 409 }
    );
  }

  const preset = parsed.data.logoKey
    ? findPreset(parsed.data.logoKey)
    : findPreset(parsed.data.name);

  try {
    const platform = await prisma.platform.create({
      data: {
        userId,
        name,
        type: parsed.data.type || preset?.type || "AUTRE",
        subtype:
          parsed.data.subtype ||
          preset?.subtype ||
          null,
        logoKey: parsed.data.logoKey || preset?.key || null,
        logoUrl: parsed.data.logoUrl || preset?.logoUrl || null,
        walletAddress: parsed.data.walletAddress || null,
        notes: parsed.data.notes,
      },
    });
    return NextResponse.json({ platform }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Cette plateforme existe déjà dans votre liste" },
        { status: 409 }
      );
    }
    console.error("[platforms POST]", e);
    return NextResponse.json(
      { error: "Erreur serveur, veuillez réessayer" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await req.json();
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const existing = await prisma.platform.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = platformSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const platform = await prisma.platform.update({
      where: { id },
      data: {
        name: parsed.data.name,
        type: parsed.data.type,
        subtype: parsed.data.subtype,
        logoKey: parsed.data.logoKey,
        logoUrl: parsed.data.logoUrl || null,
        walletAddress: parsed.data.walletAddress,
        notes: parsed.data.notes,
      },
    });
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

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const existing = await prisma.platform.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const [assetCount, txCount] = await Promise.all([
    prisma.asset.count({ where: { platformId: id } }),
    prisma.transaction.count({
      where: { OR: [{ platformId: id }, { toPlatformId: id }] },
    }),
  ]);

  if (assetCount > 0 || txCount > 0) {
    return NextResponse.json(
      {
        error: `Impossible de supprimer « ${existing.name} » : ${assetCount} actif(s) et ${txCount} transaction(s) y sont encore liés. Supprimez-les d'abord.`,
      },
      { status: 409 }
    );
  }

  try {
    await prisma.platform.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[platforms DELETE]", e);
    return NextResponse.json(
      { error: "Erreur serveur, veuillez réessayer" },
      { status: 500 }
    );
  }
}
