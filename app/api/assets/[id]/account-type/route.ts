import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";

const ALLOWED = ["CTO", "PEA", "AV", "CRYPTO", "IMMOBILIER", "CFD"] as const;

async function updateAccountType(req: Request, id: string) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const accountType = String(
    (body as { accountType?: string })?.accountType || ""
  ).toUpperCase();

  if (!(ALLOWED as readonly string[]).includes(accountType)) {
    return NextResponse.json(
      { error: "accountType invalide (CTO|PEA|AV|CRYPTO|IMMOBILIER|CFD)" },
      { status: 400 }
    );
  }

  const asset = await prisma.asset.findFirst({ where: { id, userId } });
  if (!asset) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

  const updated = await prisma.asset.update({
    where: { id },
    data: { accountType },
  });

  return NextResponse.json({
    asset: {
      id: updated.id,
      accountType: updated.accountType,
      name: updated.name,
    },
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  return updateAccountType(req, id);
}

/** Alias — certains clients envoient PUT */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  return updateAccountType(req, id);
}
