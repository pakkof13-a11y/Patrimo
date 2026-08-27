/**
 * Fournisseur IPC — INSEE, Banque de données macro-économiques (BDM).
 *
 * ## Ce qui est récupéré
 *
 * Deux séries mensuelles de l'ensemble des ménages, France entière, tous
 * articles (COICOP 00 — Ensemble), **IPC national**, pas l'IPCH :
 *
 * - la variation **mensuelle** (glissement sur un mois) ;
 * - le glissement **annuel** publié pour le même mois.
 *
 * Les deux sont conservées telles quelles. Reconstruire l'une depuis l'autre
 * ferait diverger le chiffre affiché de celui que l'INSEE annonce.
 *
 * ## Identifiants — base 2025
 *
 * Depuis janvier 2026 l'IPC est en base 2025. Les idBank de la base 2015
 * (`001759970`, `001763852`) sont des **niveaux d'indice**, arrêtés en
 * décembre 2025 : les traiter comme des taux produisait ~+120 % / mois, ou
 * plus souvent rien du tout. Les défauts ci-dessous sont les séries de
 * *variation* et de *glissement annuel* de l'ensemble, toujours surchargeables.
 *
 * ## Endpoint
 *
 * L'URL historique `bdm.insee.fr/series/sdmx/.../jsondata` répond 400.
 * L'API publique `api.insee.fr/series/BDM/V1/data/SERIES_BDM/{idBank}`
 * rend du SDMX 2.1 XML (`<Obs TIME_PERIOD OBS_VALUE>`), sans clé.
 */

import type { CpiFetchedObservation, CpiProvider } from "../cpi-collector";

/** Variation mensuelle — IPC ensemble des ménages, France, COICOP 00 Ensemble. */
export const DEFAULT_INSEE_CPI_MOM_IDBANK = "011814631";
/** Glissement annuel — même champ, même indice (pas l'IPCH). */
export const DEFAULT_INSEE_CPI_YOY_IDBANK = "011814632";
export const DEFAULT_INSEE_BDM_BASE =
  "https://api.insee.fr/series/BDM/V1/data/SERIES_BDM";

const IDBANK_MOM =
  process.env.INSEE_CPI_MOM_IDBANK?.trim() || DEFAULT_INSEE_CPI_MOM_IDBANK;
const IDBANK_YOY =
  process.env.INSEE_CPI_YOY_IDBANK?.trim() || DEFAULT_INSEE_CPI_YOY_IDBANK;
const BDM_BASE =
  process.env.INSEE_BDM_BASE?.trim() || DEFAULT_INSEE_BDM_BASE;

type SdmxObservation = { period: string; value: number | null };

const OBS_TAG = /<Obs\b([^>]*)\/?>/gi;
const ATTR = /(\w+)="([^"]*)"/g;

function normalizePeriod(raw: string): string {
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return raw;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** Extraire les observations d'une réponse SDMX-XML 2.1 structure-specific. */
export function parseSdmxXml(xml: string): SdmxObservation[] {
  const out: SdmxObservation[] = [];
  for (const match of xml.matchAll(OBS_TAG)) {
    const attrs = match[1] ?? "";
    let period: string | undefined;
    let raw: string | undefined;
    for (const attr of attrs.matchAll(ATTR)) {
      if (attr[1] === "TIME_PERIOD") period = attr[2];
      if (attr[1] === "OBS_VALUE") raw = attr[2];
    }
    if (!period) continue;
    out.push({ period: normalizePeriod(period), value: parseNumber(raw) });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Extraire les observations d'une réponse SDMX-JSON 1.0.
 *
 * Conservé : certains déploiements peuvent encore recevoir du JSON. Un format
 * inattendu rend une liste vide — le collecteur enregistrera « rien reçu ».
 */
export function parseSdmxJson(payload: unknown): SdmxObservation[] {
  const root = payload as {
    dataSets?: Array<{
      series?: Record<string, { observations?: Record<string, unknown[]> }>;
    }>;
    structure?: {
      dimensions?: {
        observation?: Array<{ id?: string; values?: Array<{ id?: string }> }>;
      };
    };
  };

  const serie = Object.values(root?.dataSets?.[0]?.series ?? {})[0];
  const observations = serie?.observations;
  if (!observations) return [];

  const timeValues =
    root?.structure?.dimensions?.observation?.find((d) => d.id === "TIME_PERIOD")
      ?.values ?? [];

  const out: SdmxObservation[] = [];
  for (const [index, cell] of Object.entries(observations)) {
    const period = timeValues[Number(index)]?.id;
    const raw = Array.isArray(cell) ? cell[0] : null;
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!period) continue;
    out.push({
      period: normalizePeriod(period),
      value: Number.isFinite(value) ? value : null,
    });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Accepte XML, JSON parsé, ou texte JSON. Jamais d'exception : liste vide
 * si le document n'est pas un SDMX d'observations.
 */
export function parseSdmxSeries(payload: unknown): SdmxObservation[] {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("<") || /<Obs\b/i.test(trimmed)) {
      return parseSdmxXml(trimmed);
    }
    try {
      return parseSdmxJson(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return parseSdmxJson(payload);
}

/**
 * Un taux publié tient en quelques points de pourcentage. Un niveau d'indice
 * (base 100) se situe autour de 100. Confondre les deux écrivait ~+120 % par
 * mois — pire qu'une absence.
 */
export function looksLikePercentSeries(obs: SdmxObservation[]): boolean {
  const values = obs
    .map((o) => o.value)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return false;
  const sorted = [...values.map(Math.abs)].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)]!;
  return mid < 30;
}

/**
 * Fusionne variations mensuelles et glissements annuels par mois.
 *
 * Les deux séries n'ont pas nécessairement la même profondeur : le glissement
 * annuel manque sur les douze premiers mois d'une base. Un mois sans glissement
 * annuel garde sa variation mensuelle.
 */
export function mergeSeries(
  mom: SdmxObservation[],
  yoy: SdmxObservation[]
): CpiFetchedObservation[] {
  const yoyByPeriod = new Map(yoy.map((o) => [o.period, o.value]));
  const out: CpiFetchedObservation[] = [];

  for (const o of mom) {
    if (o.value == null) continue;
    const annuel = yoyByPeriod.get(o.period);
    out.push({
      period: o.period,
      monthlyRate: o.value / 100,
      yearlyRate: annuel == null ? null : annuel / 100,
    });
  }
  return out;
}

async function fetchSeries(idBank: string, signal: AbortSignal) {
  const url = `${BDM_BASE.replace(/\/$/, "")}/${encodeURIComponent(idBank)}`;
  const res = await fetch(url, {
    signal,
    headers: {
      accept: "application/xml, application/json;q=0.8, */*;q=0.1",
      "user-agent": "Patrimo/ipc-collector",
    },
  });
  if (!res.ok) {
    throw new Error(`INSEE BDM ${idBank} → ${res.status}`);
  }
  const body = await res.text();
  const parsed = parseSdmxSeries(body);
  if (!looksLikePercentSeries(parsed)) {
    throw new Error(
      `INSEE BDM ${idBank} : la série ne ressemble pas à un taux (niveau d'indice ?)`
    );
  }
  return parsed;
}

export const inseeCpiProvider: CpiProvider = {
  id: "INSEE-BDM",

  async fetch({ sinceMonths }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const [mom, yoy] = await Promise.all([
        fetchSeries(IDBANK_MOM, controller.signal),
        fetchSeries(IDBANK_YOY, controller.signal),
      ]);
      const fused = mergeSeries(mom, yoy);
      return Number.isFinite(sinceMonths) ? fused.slice(-sinceMonths) : fused;
    } finally {
      clearTimeout(timer);
    }
  },
};
