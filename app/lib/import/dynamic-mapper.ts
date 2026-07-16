/**
 * Auto-matching intelligent des en-têtes CSV → rôles de colonnes.
 * Utilisé comme fallback quand aucune plateforme n'est reconnue,
 * ou pour compléter un mapping partiel.
 */

import { normalizeHeader } from "./csv-parse";
import type {
  ColumnMapping,
  ColumnRole,
  HeaderMatchResult,
  MappingConfidence,
} from "./types";

/** Mots-clés (headers normalisés) → rôle, avec poids */
const KEYWORD_RULES: Array<{ role: ColumnRole; patterns: RegExp[]; weight: number }> = [
  {
    role: "date",
    weight: 10,
    patterns: [
      /^date$/,
      /^datetime$/,
      /^date_time$/,
      /^timestamp$/,
      /^time$/,
      /^utc_time$/,
      /^trade_date$/,
      /^execution_date$/,
      /^date_operation$/,
      /^date_valeur$/,
      /^started_date$/,
      /^completed_date$/,
      /^occurred_at$/,
      /date/,
    ],
  },
  {
    role: "type",
    weight: 9,
    patterns: [
      /^type$/,
      /^operation$/,
      /^transaction_type$/,
      /^type_operation$/,
      /^action$/,
      /^mouvement$/,
    ],
  },
  {
    role: "side",
    weight: 8,
    patterns: [/^side$/, /^buy_sell$/, /^sens$/, /^direction$/],
  },
  {
    role: "ticker",
    weight: 9,
    patterns: [
      /^ticker$/,
      /^symbol$/,
      /^isin$/,
      /^code$/,
      /^pair$/,
      /^market$/,
      /^asset$/,
      /^coin$/,
      /^instrument$/,
      /^valeur_code$/,
    ],
  },
  {
    role: "name",
    weight: 6,
    patterns: [
      /^name$/,
      /^nom$/,
      /^libelle$/,
      /^label$/,
      /^product$/,
      /^description$/,
      /^actif$/,
      /^security$/,
      /^instrument_name$/,
    ],
  },
  {
    role: "quantity",
    weight: 9,
    patterns: [
      /^quantity$/,
      /^qty$/,
      /^quantite$/,
      /^parts$/,
      /^shares$/,
      /^size$/,
      /^executed$/,
      /^quantity_transacted$/,
      /^units$/,
      /^nombre$/,
    ],
  },
  {
    role: "unitPrice",
    weight: 9,
    patterns: [
      /^price$/,
      /^unit_price$/,
      /^prix$/,
      /^prix_unitaire$/,
      /^cours$/,
      /^avg_price$/,
      /^execution_price$/,
      /^price_per_share$/,
      /^spot_price/,
      /^nav$/,
      /^execution$/,
    ],
  },
  {
    role: "fees",
    weight: 7,
    patterns: [
      /^fee$/,
      /^fees$/,
      /^frais$/,
      /^commission$/,
      /^trading_fee$/,
      /^fees_and_or_spread$/,
      /^cost$/,
    ],
  },
  {
    role: "currency",
    weight: 6,
    patterns: [
      /^currency$/,
      /^devise$/,
      /^ccy$/,
      /^quote_currency$/,
      /^spot_price_currency$/,
    ],
  },
  {
    role: "cashAmount",
    weight: 7,
    patterns: [
      /^amount$/,
      /^total$/,
      /^total_amount$/,
      /^montant$/,
      /^cash$/,
      /^cash_amount$/,
      /^subtotal$/,
      /^notional$/,
      /^valeur$/,
    ],
  },
  {
    role: "notes",
    weight: 3,
    patterns: [/^notes$/, /^note$/, /^remark$/, /^commentaire$/, /^memo$/],
  },
  {
    role: "description",
    weight: 4,
    patterns: [/^description$/, /^details$/, /^detail$/],
  },
  {
    role: "assetClass",
    weight: 4,
    patterns: [/^asset_class$/, /^classe$/, /^class$/, /^category$/],
  },
];

const REQUIRED_GROUPS: ColumnRole[][] = [
  ["date"],
  ["type", "side"],
  ["ticker", "name"],
  ["quantity"],
  ["unitPrice", "cashAmount"],
];

function bestRoleForHeader(normalized: string): { role: ColumnRole; weight: number } | null {
  let best: { role: ColumnRole; weight: number } | null = null;
  for (const rule of KEYWORD_RULES) {
    for (const re of rule.patterns) {
      if (re.test(normalized)) {
        // Prefer exact-ish (shorter pattern or ^$)
        const exact = re.source.startsWith("^") && re.source.endsWith("$");
        const w = exact ? rule.weight + 2 : rule.weight;
        if (!best || w > best.weight) {
          best = { role: rule.role, weight: w };
        }
        break;
      }
    }
  }
  return best;
}

function confidenceFrom(score: number, missing: ColumnRole[]): MappingConfidence {
  if (missing.length === 0 && score >= 40) return "high";
  if (missing.length <= 1 && score >= 25) return "medium";
  if (score >= 15) return "low";
  return "none";
}

/**
 * Auto-associe les en-têtes CSV aux rôles métier.
 * Un rôle n'est attribué qu'à une seule colonne (meilleur score).
 */
export function autoMatchHeaders(headers: string[]): HeaderMatchResult {
  type Cand = { header: string; role: ColumnRole; weight: number };
  const candidates: Cand[] = [];

  for (const h of headers) {
    const key = normalizeHeader(h);
    if (!key) continue;
    const match = bestRoleForHeader(key);
    if (match) candidates.push({ header: h, role: match.role, weight: match.weight });
  }

  // Assign uniquely by weight desc
  candidates.sort((a, b) => b.weight - a.weight);
  const usedRoles = new Set<ColumnRole>();
  const usedHeaders = new Set<string>();
  const columnMap: ColumnMapping = {};
  let score = 0;

  for (const c of candidates) {
    if (usedRoles.has(c.role) || usedHeaders.has(c.header)) continue;
    // description vs name conflict: prefer name if both map
    usedRoles.add(c.role);
    usedHeaders.add(c.header);
    columnMap[c.header] = c.role;
    score += c.weight;
  }

  const missingRoles: ColumnRole[] = [];
  for (const group of REQUIRED_GROUPS) {
    if (!group.some((r) => usedRoles.has(r))) {
      missingRoles.push(group[0]!);
    }
  }

  const matchedRoles = [...usedRoles];
  const confidence = confidenceFrom(score, missingRoles);

  return {
    columnMap,
    missingRoles,
    confidence,
    score,
    matchedRoles,
  };
}

/** Fusionne un mapping manuel sur un auto-match (manuel prioritaire). */
export function mergeColumnMaps(
  auto: ColumnMapping,
  manual?: ColumnMapping | null
): ColumnMapping {
  if (!manual || Object.keys(manual).length === 0) return { ...auto };
  const out: ColumnMapping = { ...auto };
  for (const [h, role] of Object.entries(manual)) {
    // Clear previous assignment of this role
    for (const [hh, rr] of Object.entries(out)) {
      if (rr === role && hh !== h) delete out[hh];
    }
    out[h] = role;
  }
  return out;
}

export function mappingNeedsUserInput(result: HeaderMatchResult): boolean {
  return (
    result.confidence === "none" ||
    result.confidence === "low" ||
    result.missingRoles.length > 0
  );
}

/** Fingerprint stable d'un jeu d'en-têtes (pour mémoriser le mapping). */
export function headersFingerprint(headers: string[]): string {
  return headers
    .map((h) => normalizeHeader(h))
    .filter(Boolean)
    .sort()
    .join("|");
}
