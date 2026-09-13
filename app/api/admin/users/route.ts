import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/lib/prisma-client/client";
import {
  adminGateJson,
  gateAdmin,
  invalidateUserAccessCache,
} from "@/app/lib/auth-helpers";
import { createUserSchema, resetPasswordSchema } from "@/app/lib/schemas";
import { resetUserData } from "@/app/lib/portfolio/clear-user-data";
import { serverErrorDetail } from "@/app/lib/api/error-response";

/** Liste des utilisateurs — ADMIN only */
export async function GET() {
  const gate = await gateAdmin();
  if (!gate.ok) return adminGateJson(gate);

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      baseCurrency: true,
    },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}

/** Création d'utilisateur — ADMIN only */
export async function POST(req: Request) {
  const gate = await gateAdmin();
  if (!gate.ok) return adminGateJson(gate);

  const body = await req.json().catch(() => ({}));
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides" },
      { status: 400 }
    );
  }

  const { username, password, role, name } = parsed.data;
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: username, mode: "insensitive" } },
        { email: { equals: `${username}@patrimo.local`, mode: "insensitive" } },
      ],
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Cet identifiant est déjà utilisé" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      username,
      email: `${username}@patrimo.local`,
      name: name?.trim() || username,
      passwordHash,
      role: role === "ADMIN" ? "ADMIN" : "USER",
      baseCurrency: "EUR",
    },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    user: { ...user, createdAt: user.createdAt.toISOString() },
  });
}

/** Réinitialisation mot de passe — ADMIN only */
export async function PATCH(req: Request) {
  const gate = await gateAdmin();
  if (!gate.ok) return adminGateJson(gate);

  const body = await req.json().catch(() => ({}));
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Données invalides" },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
  });
  if (!target) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash },
  });

  // Force re-check accès (mot de passe changé — cache accès inchangé mais propre)
  await invalidateUserAccessCache(target.id);

  return NextResponse.json({ ok: true, userId: target.id });
}

/**
 * Suppression d'un utilisateur et de toutes ses données — ADMIN only, pas
 * soi-même.
 *
 * JOU-04 : `prisma.user.delete` seul comptait sur la cascade DB depuis
 * `User`. Or `Transaction` n'a aucune FK vers `User` (elle ne cascade donc
 * jamais) et ses FK `platformId` / `assetId` sont en `onDelete: Restrict`
 * (prisma/schema.prisma) : la cascade `User → Platform` / `User → Asset`
 * heurtait ces contraintes dès que le compte avait écrit une ligne de
 * journal → P2003 non capturée → 500 brut, rien de supprimé. Même racine
 * pour `SecuritiesAccount.platformId` (Restrict) et `NftItemDetail.nftAssetId`
 * (Restrict).
 *
 * `resetUserData` fait déjà ce nettoyage dans l'ordre compatible avec ces
 * contraintes (transactions → actifs → … → comptes-titres → plateformes),
 * filtré par `userId` à chaque étape, en une seule transaction. On l'appelle
 * donc AVANT `user.delete` : il ne reste alors attaché à `User` que
 * `Account` / `Session` (Cascade), et la suppression du compte passe sans
 * toucher au schéma — ni au journal d'un autre utilisateur.
 */
export async function DELETE(req: Request) {
  const gate = await gateAdmin();
  if (!gate.ok) return adminGateJson(gate);
  const admin = gate.user;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("id");
  if (!userId) {
    return NextResponse.json({ error: "id requis" }, { status: 400 });
  }
  if (userId === admin.id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas supprimer votre propre compte" },
      { status: 400 }
    );
  }

  // Id inconnu → 404 explicite (même contrat que PATCH), au lieu d'un P2025
  // levé par `user.delete` et rendu en 500.
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  try {
    await resetUserData(target.id);
    await prisma.user.delete({ where: { id: target.id } });
  } catch (e) {
    console.error("[admin/users DELETE]", target.id, serverErrorDetail(e));
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2003") {
        // Une FK Restrict que le nettoyage ne couvre pas : erreur métier
        // lisible, sans exposer le nom de la contrainte.
        return NextResponse.json(
          {
            error:
              "Suppression refusée : des données rattachées à ce compte empêchent encore sa suppression.",
          },
          { status: 409 }
        );
      }
      if (e.code === "P2025") {
        // Supprimé entre le contrôle d'existence et le `delete`.
        return NextResponse.json(
          { error: "Utilisateur introuvable" },
          { status: 404 }
        );
      }
    }
    return NextResponse.json(
      { error: "Erreur base de données lors de la suppression du compte" },
      { status: 500 }
    );
  }

  await invalidateUserAccessCache(target.id);

  return NextResponse.json({ ok: true });
}
