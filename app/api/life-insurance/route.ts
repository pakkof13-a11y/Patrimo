import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import {
  lifeInsuranceSchema,
  lifeInsuranceTaxProfileSchema,
  lifeInsuranceUpdateSchema,
  lifeProductUpdateSchema,
} from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { listLifeInsurances } from "@/app/lib/cash/pockets";
import { listSupports } from "@/app/lib/life-insurance/support-service";
import { d } from "@/app/lib/money/decimal";
import {
  checkPremiumsSplit,
  exceedsPfuOutstandingThreshold,
  isTaxHousehold,
  totalLifeInsuranceOutstandingEur,
  type TaxHousehold,
} from "@/app/lib/life-insurance/fiscal";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const [legacyPolicies, user, supports] = await Promise.all([
    listLifeInsurances(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { taxHousehold: true },
    }),
    listSupports(userId),
  ]);

  /**
   * Encours d'un contrat = ses supports du journal. Rien d'autre.
   *
   * `listLifeInsurances` ne connaît que les champs historiques — `cashEuro` et
   * `products` — que la migration vers le journal doit reprendre. Les ignorer
   * affichait « Encours 0 € » sur un contrat portant 156 000 € de supports ;
   * les additionner faisait diverger le module du patrimoine de 37 800 €, le
   * patrimoine ne comptant que le journal. Aucune des deux n'était juste.
   *
   * Le journal fait foi, et ce qui l'attend est annoncé à part : le reliquat
   * garde sa propre grandeur, `legacyOutstandingEur`, pour que l'écran puisse
   * le nommer. Le fondre dans l'encours le rendrait invisible ; le taire
   * ferait disparaître de l'argent réel — le script de migration classe ces
   * montants « supports à migrer », jamais « doublons ».
   */
  const supportsByContract = new Map<string, ReturnType<typeof d>>();
  for (const s of supports) {
    if (!s.lifeInsuranceId) continue;
    const current = supportsByContract.get(s.lifeInsuranceId) ?? d(0);
    supportsByContract.set(
      s.lifeInsuranceId,
      current.plus(d(s.currentValueEur ?? "0"))
    );
  }
  const policies = legacyPolicies.map((p) => ({
    ...p,
    outstandingEur: (supportsByContract.get(p.id) ?? d(0)).toFixed(8),
    /** Saisie d'avant le journal, en attente de reprise. Hors encours. */
    legacyOutstandingEur: d(p.outstandingEur).toFixed(8),
  }));
  const taxHousehold: TaxHousehold = isTaxHousehold(user?.taxHousehold)
    ? user!.taxHousehold
    : "SINGLE";
  const totalOutstandingEur = totalLifeInsuranceOutstandingEur(
    policies.map((p) => p.outstandingEur)
  );
  /** Ce que la migration vers le journal doit encore reprendre. */
  const totalLegacyOutstandingEur = totalLifeInsuranceOutstandingEur(
    policies.map((p) => p.legacyOutstandingEur)
  );
  // Le seuil fiscal de 150 000 € porte sur les PRIMES VERSÉES, jamais sur
  // l'encours : sinon la performance des marchés changerait le taux
  // d'imposition. L'encours reste rendu pour l'affichage du patrimoine.
  const totalPremiumsBefore2017Eur = totalLifeInsuranceOutstandingEur(
    policies.map((p) => p.premiumsBefore2017Eur)
  );
  const totalPremiumsAfter2017Eur = totalLifeInsuranceOutstandingEur(
    policies.map((p) => p.premiumsAfter2017Eur)
  );
  return NextResponse.json({
    policies,
    taxHousehold,
    totalOutstandingEur,
    totalLegacyOutstandingEur,
    totalPremiumsBefore2017Eur,
    totalPremiumsAfter2017Eur,
    exceedsPfuThreshold: exceedsPfuOutstandingThreshold(
      d(totalPremiumsBefore2017Eur).plus(d(totalPremiumsAfter2017Eur)).toString()
    ),
  });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();

  /*
    Les lignes `LifeInsuranceProduct` précèdent le journal.

    Un support d'assurance-vie est désormais une position comme une autre —
    actif, transaction, valorisation — et c'est `POST /api/life-insurance/supports`
    qui l'écrit. En créer une ici ajouterait un montant que le patrimoine ne
    compte pas : la divergence même que ce chantier corrige, recréée à volonté.

    Les lignes existantes restent lisibles et modifiables, et la migration sait
    les reprendre. Seule la création est fermée.
  */
  if (body?.kind === "product") {
    return NextResponse.json(
      {
        error:
          "Les supports d'assurance-vie sont désormais des positions du journal. " +
          "Ajoutez ce support depuis la gestion du contrat pour qu'il compte " +
          "dans le patrimoine.",
      },
      { status: 409 }
    );
  }

  const parsed = lifeInsuranceSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const split = checkPremiumsSplit({
    premiumsBefore2017Eur: parsed.data.premiumsBefore2017Eur || "0",
    premiumsAfter2017Eur: parsed.data.premiumsAfter2017Eur || "0",
    totalPremiumsEur: parsed.data.totalPremiumsEur,
  });
  if (!split.ok) {
    return NextResponse.json({ error: split.error }, { status: 400 });
  }
  const policy = await prisma.lifeInsurance.create({
    data: {
      userId,
      insurer: parsed.data.insurer,
      openDate: parsed.data.openDate ? new Date(parsed.data.openDate) : null,
      /*
        Le fonds euro d'un contrat est un support du journal, pas un champ du
        contrat. On accepte encore la clé pour ne pas casser les appelants — les
        deux écrans envoient « 0 » — mais on n'écrit jamais autre chose que
        zéro : une valeur non nulle créerait un montant hors patrimoine.
      */
      cashEuro: new Prisma.Decimal(0),
      currency: (parsed.data.currency || "EUR").toUpperCase(),
      notes: parsed.data.notes || null,
      premiumsBefore2017Eur: new Prisma.Decimal(split.premiumsBefore2017Eur),
      premiumsAfter2017Eur: new Prisma.Decimal(split.premiumsAfter2017Eur),
    },
  });
  return NextResponse.json({ policy }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();

  // Situation fiscale du foyer (une fois pour tous les contrats).
  if (body?.kind === "tax-profile") {
    const parsed = lifeInsuranceTaxProfileSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { taxHousehold: parsed.data.taxHousehold },
      select: { taxHousehold: true },
    });
    return NextResponse.json({ taxHousehold: user.taxHousehold });
  }

  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  if (body?.kind === "product") {
    const product = await prisma.lifeInsuranceProduct.findFirst({
      where: { id, lifeInsurance: { userId } },
    });
    if (!product) return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });

    const parsed = lifeProductUpdateSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);

    const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
    const data: Prisma.LifeInsuranceProductUpdateInput = {};
    if (f.name !== undefined) data.name = f.name;
    if (f.currentValue !== undefined)
      data.currentValue = new Prisma.Decimal(f.currentValue || "0");
    if (f.currency !== undefined) data.currency = f.currency;
    if (f.notes !== undefined) data.notes = f.notes || null;

    const write = await prisma.lifeInsuranceProduct.updateMany({
      where: { id, lifeInsurance: { userId } },
      data,
    });
    if (write.count === 0) {
      return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
    }
    const updated = await prisma.lifeInsuranceProduct.findFirst({
      where: { id, lifeInsurance: { userId } },
    });
    return NextResponse.json({ product: updated });
  }

  const existing = await prisma.lifeInsurance.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = lifeInsuranceUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.LifeInsuranceUpdateInput = {};
  if (f.insurer !== undefined) data.insurer = f.insurer;
  if (f.openDate !== undefined) data.openDate = f.openDate ? new Date(f.openDate) : null;
  /*
    `cashEuro` n'est plus modifiable à la hausse : seule la remise à zéro reste
    permise, c'est ce que fait la migration une fois le montant repris au
    journal. Refuser silencieusement induirait en erreur — on le dit.
  */
  if (f.cashEuro !== undefined && d(f.cashEuro || "0").gt(0)) {
    return NextResponse.json(
      {
        error:
          "Le fonds euro d'un contrat se saisit comme support au journal, " +
          "plus comme un montant du contrat.",
      },
      { status: 409 }
    );
  }
  if (f.cashEuro !== undefined) data.cashEuro = new Prisma.Decimal(0);
  if (f.currency !== undefined) data.currency = f.currency;
  if (f.notes !== undefined) data.notes = f.notes || null;

  const touchesPremiums =
    f.premiumsBefore2017Eur !== undefined ||
    f.premiumsAfter2017Eur !== undefined ||
    f.totalPremiumsEur !== undefined;
  if (touchesPremiums) {
    const split = checkPremiumsSplit({
      premiumsBefore2017Eur:
        f.premiumsBefore2017Eur ?? existing.premiumsBefore2017Eur.toString(),
      premiumsAfter2017Eur:
        f.premiumsAfter2017Eur ?? existing.premiumsAfter2017Eur.toString(),
      totalPremiumsEur: f.totalPremiumsEur,
    });
    if (!split.ok) {
      return NextResponse.json({ error: split.error }, { status: 400 });
    }
    data.premiumsBefore2017Eur = new Prisma.Decimal(split.premiumsBefore2017Eur);
    data.premiumsAfter2017Eur = new Prisma.Decimal(split.premiumsAfter2017Eur);
  }

  const write = await prisma.lifeInsurance.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const policy = await prisma.lifeInsurance.findFirst({ where: { id, userId } });
  return NextResponse.json({ policy });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  if (kind === "product") {
    await prisma.lifeInsuranceProduct.deleteMany({
      where: { id, lifeInsurance: { userId } },
    });
  } else {
    await prisma.lifeInsurance.deleteMany({ where: { id, userId } });
  }
  return NextResponse.json({ ok: true });
}
