import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import { AccountingError } from "@/app/lib/accounting";
import {
  attachSupportToContract,
  createSupport,
  deleteSupport,
  LifeInsuranceInputError,
  listSupports,
  revalueSupport,
  updateSupportDetails,
} from "@/app/lib/life-insurance/support-service";
import {
  COUPON_FREQUENCIES,
  SUPPORT_KINDS,
} from "@/app/lib/life-insurance/constants";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

const createSchema = z.object({
  lifeInsuranceId: z.string().min(1),
  name: z.string().trim().min(1, "Nom du support requis").max(200),
  kind: z.enum(Object.keys(SUPPORT_KINDS) as [string, ...string[]]),
  amountEur: decimalString,
  entryFeesEur: decimalString.optional().nullable(),
  investedAt: z.string().optional().nullable(),

  isin: z.string().trim().max(20).optional().nullable(),
  issuer: z.string().trim().max(160).optional().nullable(),

  underlying: z.string().trim().max(200).optional().nullable(),
  nominalEur: decimalString.optional().nullable(),
  strikeLevel: decimalString.optional().nullable(),
  couponRatePct: decimalString.optional().nullable(),
  couponFrequency: z
    .enum(Object.keys(COUPON_FREQUENCIES) as [string, ...string[]])
    .optional()
    .nullable(),
  couponBarrierPct: decimalString.optional().nullable(),
  couponMemory: z.boolean().optional().nullable(),
  autocallBarrierPct: decimalString.optional().nullable(),
  capitalProtectionPct: decimalString.optional().nullable(),
  strikeDate: z.string().optional().nullable(),
  maturityDate: z.string().optional().nullable(),
  nextObservationDate: z.string().optional().nullable(),
  entryFeePct: decimalString.optional().nullable(),
  managementFeePct: decimalString.optional().nullable(),

  notes: z.string().trim().max(2000).optional().nullable(),
});

/** Réévaluation, rattachement, ou mise à jour de caractéristiques. */
const updateSchema = z.union([
  z.object({
    action: z.literal("revalue"),
    assetId: z.string().min(1),
    valueEur: decimalString,
  }),
  z.object({
    action: z.literal("attach"),
    assetId: z.string().min(1),
    lifeInsuranceId: z.string().min(1).nullable(),
  }),
  z.object({
    action: z.literal("details"),
    assetId: z.string().min(1),
    patch: createSchema.partial().omit({ lifeInsuranceId: true, kind: true }),
  }),
]);

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  try {
    return NextResponse.json({ supports: await listSupports(userId) });
  } catch (e) {
    console.error("[life-insurance/supports GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des supports") },
      { status: clientErrorStatus(e) }
    );
  }
}

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
      {
        error: "Paramètres invalides",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    const result = await createSupport(userId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof LifeInsuranceInputError || e instanceof AccountingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[life-insurance/supports POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création du support impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

export async function PUT(req: Request) {
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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Paramètres invalides",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    const data = parsed.data;
    if (data.action === "revalue") {
      await revalueSupport(userId, data.assetId, data.valueEur);
    } else if (data.action === "attach") {
      await attachSupportToContract(userId, data.assetId, data.lifeInsuranceId);
    } else {
      await updateSupportDetails(userId, data.assetId, data.patch);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LifeInsuranceInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[life-insurance/supports PUT]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const assetId = new URL(req.url).searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "assetId requis" }, { status: 400 });
  }

  try {
    await deleteSupport(userId, assetId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LifeInsuranceInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[life-insurance/supports DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
