/**
 * Fournisseur IPC — INSEE, Banque de données macro-économiques (BDM).
 *
 * ## Ce qui est récupéré
 *
 * Deux séries mensuelles de l'ensemble des ménages, France entière, tous
 * articles :
 *
 * - la variation **mensuelle** (glissement sur un mois) ;
 * - le glissement **annuel** publié pour le même mois.
 *
 * Les deux sont conservées telles quelles. Reconstruire l'une depuis l'autre
 * ferait diverger le chiffre affiché de celui que l'INSEE annonce, et c'est ce
 * chiffre-là que l'utilisateur reconnaîtra.
 *
 * ## Identifiants de séries
 *
 * Les `idBank` sont configurables : l'INSEE renumérote ses séries lors des
 * changements de base (base 2015 → base 2025, par exemple), et une constante
 * codée en dur se périmerait sans bruit. Les valeurs par défaut correspondent à
 * l'IPC ensemble des ménages, France, tous articles.
 *
 * ## Avertissement honnête
 *
 * **Ce fournisseur n'a jamais été exécuté contre l'API réelle.** L'environnement
 * de développement n'a pas d'accès sortant vers `api.insee.fr` ni
 * `bdm.insee.fr` — vérifié, les deux répondent `000`. Le format de réponse est
 * donc implémenté d'après la documentation SDMX-JSON de l'INSEE, et non
 * d'après une réponse observée. La première exécution en environnement connecté
 * devra vérifier que les valeurs correspondent à celles publiées.
 */

import type { CpiFetchedObservation, CpiProvider } from "../cpi-collector";

/** Série de la variation mensuelle de l'IPC — ensemble des ménages, France. */
const IDBANK_MOM = process.env.INSEE_CPI_MOM_IDBANK?.trim() || "001759970";
/** Série du glissement annuel de l'IPC — même champ. */
const IDBANK_YOY = process.env.INSEE_CPI_YOY_IDBANK?.trim() || "001763852";

const BDM_BASE =
  process.env.INSEE_BDM_BASE?.trim() || "https://bdm.insee.fr/series/sdmx/data/SERIES_BDM";

/**
 * Une observation SDMX telle que la BDM la rend.
 *
 * Le format est verbeux ; seuls la période et la valeur nous intéressent. Les
 * attributs de qualité (provisoire, révisé) ne sont pas exploités ici : une
 * révision se traduit par une nouvelle valeur, que le collecteur reprend.
 */
type SdmxObservation = { period: string; value: number | null };

/**
 * Extrait les observations d'une réponse SDMX-JSON.
 *
 * Écrit défensivement : un format inattendu rend une liste vide plutôt qu'une
 * exception, et le collecteur enregistrera « rien reçu » — ce qui est vrai —
 * au lieu de tomber.
 */
export function parseSdmxSeries(payload: unknown): SdmxObservation[] {
  const root = payload as {
    dataSets?: Array<{ series?: Record<string, { observations?: Record<string, unknown[]> }> }>;
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
    out.push({ period, value: Number.isFinite(value) ? value : null });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Fusionne variations mensuelles et glissements annuels par mois.
 *
 * Les deux séries n'ont pas nécessairement la même profondeur : le glissement
 * annuel manque sur les douze premiers mois d'une base. Un mois sans glissement
 * annuel garde sa variation mensuelle — la fenêtre courte reste calculable,
 * seule la fenêtre longue attendra.
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
      // L'INSEE publie des pourcentages ; le stockage est en fraction.
      monthlyRate: o.value / 100,
      yearlyRate: annuel == null ? null : annuel / 100,
    });
  }
  return out;
}

async function fetchSeries(idBank: string, signal: AbortSignal) {
  const url = `${BDM_BASE}/${encodeURIComponent(idBank)}?format=jsondata`;
  const res = await fetch(url, {
    signal,
    headers: { accept: "application/vnd.sdmx.data+json;version=1.0.0" },
  });
  if (!res.ok) {
    throw new Error(`INSEE BDM ${idBank} → ${res.status}`);
  }
  return parseSdmxSeries(await res.json());
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
      /*
        La profondeur est bornée côté client : la BDM rend la série entière, et
        rien ne justifie de réécrire trente ans de mois à chaque passage.
      */
      return Number.isFinite(sinceMonths) ? fused.slice(-sinceMonths) : fused;
    } finally {
      clearTimeout(timer);
    }
  },
};
