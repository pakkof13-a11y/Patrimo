import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import {
  applyComputedFilters,
  getDefiPortfolio,
} from "@/app/lib/crypto/defi-portfolio-service";
import {
  ACCESS_MODE_KEYS,
  POSITION_STATUS_KEYS,
  VALUATION_METHOD_KEYS,
} from "@/app/lib/crypto/defi-taxonomy";
import { DEFI_POSITION_TYPES } from "@/app/lib/crypto/constants";

export const dynamic = "force-dynamic";

/**
 * Drapeau passé en query string.
 *
 * `undefined` (absent) et `false` ne sont pas la même chose : sur `isHidden`,
 * l'un veut dire « toutes les positions », l'autre « seulement les visibles ».
 * Un simple `Boolean(param)` écraserait cette distinction.
 */
const boolFlag = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const querySchema = z.object({
  accessMode: z.enum(ACCESS_MODE_KEYS).optional(),
  platformId: z.string().min(1).optional(),
  ownerLabel: z.string().trim().min(1).max(120).optional(),
  chain: z.string().trim().min(1).max(40).optional(),
  protocol: z.string().trim().min(1).max(80).optional(),
  positionType: z
    .enum(Object.keys(DEFI_POSITION_TYPES) as [string, ...string[]])
    .optional(),
  status: z.enum(POSITION_STATUS_KEYS).optional(),
  strategyId: z.string().min(1).optional(),
  isHidden: boolFlag,
  isIgnoredInPortfolio: boolFlag,
  withDebt: boolFlag,
  withRewards: boolFlag,
  stale: boolFlag,
  valuationMethod: z.enum(VALUATION_METHOD_KEYS).optional(),
  includeInactive: boolFlag,
});

/**
 * GET /api/crypto/defi/portfolio
 *
 * Vue enrichie des positions DeFi / CeFi / CeDeFi : décomposition par jambes,
 * méthode de valorisation, dettes et collatéraux, récompenses, agrégats par
 * chaîne / protocole / type / mode d'accès, et conflits de double compte.
 *
 * Distincte de `GET /api/crypto/defi`, qui reste la vue historique consommée par
 * l'onglet existant. Deux routes plutôt qu'une réponse élargie : les
 * consommateurs actuels n'ont pas à absorber un contrat trois fois plus gros
 * pour continuer d'afficher ce qu'ils affichaient.
 *
 * GET et non POST malgré la richesse des filtres : la réponse est en lecture
 * seule et ne contient aucune donnée qui n'ait sa place dans un cache HTTP privé.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Filtres invalides",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    const bundle = await getDefiPortfolio(userId, parsed.data);

    // `withDebt` / `withRewards` / `stale` / `valuationMethod` portent sur des
    // grandeurs calculées, pas sur des colonnes : ils sont appliqués après
    // valorisation. Les totaux, eux, restent ceux de l'ensemble non filtré —
    // filtrer l'affichage ne doit pas changer ce que pèse le portefeuille.
    const positions = applyComputedFilters(bundle.positions, parsed.data);

    return NextResponse.json({
      ...bundle,
      positions,
      filteredPositionCount: positions.length,
    });
  } catch (e) {
    console.error("[crypto/defi/portfolio GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Chargement du portefeuille DeFi impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
