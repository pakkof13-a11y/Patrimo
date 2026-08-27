import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { updateAccountTypeSchema } from "@/app/lib/schemas";
import { validationErrorResponse } from "@/app/lib/api/validation";
import {
  detailOrphanError,
  detailRequirementError,
} from "@/app/lib/assets/envelope-requirements";
import { envelopeChangeBreaksAttachment } from "@/app/lib/securities/constants";

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

  const parsed = updateAccountTypeSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const asset = await prisma.asset.findFirst({
    where: { id, userId },
    include: {
      realEstate: { select: { id: true } },
      indirectRealEstate: { select: { id: true } },
      // Le compte de rattachement décide si celui-ci survit au changement.
      securitiesAccount: { select: { envelopeType: true } },
    },
  });
  if (!asset) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

  /*
    Le reclassement change ce que l'actif pèse et où il se lit, en une requête.
    Poser IMMOBILIER sur un actif sans fiche le fait entrer au patrimoine et
    dans l'assiette IFI sans qu'aucun onglet du module ne le liste — l'état
    exact dans lequel deux SCPI ont vécu. Le retirer d'IMMOBILIER abandonne sa
    fiche, que son onglet continue d'afficher, à 0 €.
  */
  const presence = {
    hasRealEstate: asset.realEstate != null,
    hasIndirectRealEstate: asset.indirectRealEstate != null,
  };
  const refus =
    detailRequirementError(parsed.data.accountType, presence) ??
    detailOrphanError(asset.accountType, parsed.data.accountType, presence);
  if (refus) {
    return NextResponse.json({ error: refus }, { status: 409 });
  }

  /*
    Un rattachement à un compte titres ne survit pas à un changement de famille
    fiscale.

    `setAssetAccount` refuse déjà de créer un tel état ; cette route le créait
    par omission, en n'écrivant que `accountType`. Une ligne devenue PEA
    continuait alors de pointer vers un compte CTO : elle s'affichait dans la
    carte de ce CTO, entrait dans sa valeur liquidative, dans sa simulation de
    retrait et dans son rapport fiscal — tout en se déclarant PEA. Et elle
    échappait au bandeau des lignes non rattachées, puisqu'elle avait bien un
    compte. Une ligne mal attribuée est plus coûteuse qu'une ligne orpheline :
    la seconde se voit.

    Détacher, et rien de plus : choisir à sa place un compte de la nouvelle
    enveloppe reviendrait à inventer une information que l'utilisateur seul
    détient. La ligne redevient non rattachée — un état valide, et visible.
  */
  const detache = envelopeChangeBreaksAttachment(
    asset.securitiesAccount?.envelopeType,
    parsed.data.accountType
  );

  const write = await prisma.asset.updateMany({
    where: { id, userId },
    data: {
      accountType: parsed.data.accountType,
      ...(detache ? { securitiesAccountId: null } : {}),
    },
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }
  const updated = await prisma.asset.findFirst({ where: { id, userId } });
  if (!updated) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

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
