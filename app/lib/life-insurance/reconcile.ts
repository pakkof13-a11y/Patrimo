/**
 * Réconciliation des deux façons dont une assurance-vie a pu être saisie.
 *
 * Historiquement, l'AV disposait de sa propre table (`LifeInsurance` +
 * `LifeInsuranceProduct`) valorisée à la main, **en parallèle** du journal de
 * transactions. Les deux chemins alimentaient le patrimoine net par des voies
 * différentes — les positions du journal via `marketValue`, la table via le
 * cash — si bien qu'un même support saisi des deux côtés comptait deux fois.
 *
 * Ce module ne décide pas seul : il compare les deux sources et **nomme** les
 * doublons, pour qu'une migration ou un écran de contrôle puisse trancher. Il
 * est volontairement pur (ni Prisma, ni réseau) afin que la règle de
 * rapprochement soit testable sans base.
 *
 * ## Pourquoi un rapprochement par nom
 *
 * Rien ne relie techniquement « UC Amundi MSCI World » (table) à
 * « Amundi MSCI World » (journal) : pas d'ISIN côté table, pas de clé
 * étrangère. Le nom est le seul indice disponible. On le normalise donc en
 * retirant ce qui relève de l'habillage commercial (préfixes « UC », « ETF »,
 * mentions de support) plutôt que d'exiger une égalité stricte qui ne
 * rapprocherait jamais rien.
 *
 * Le rapprochement reste une **présomption** : il est rendu comme tel, jamais
 * appliqué en silence. Fusionner à tort deux supports distincts ferait
 * disparaître de l'argent du patrimoine, ce qui est pire que de laisser un
 * doublon visible.
 */

/**
 * Habillage commercial retiré avant comparaison.
 *
 * `UC` (unité de compte) et `ETF` qualifient l'enveloppe du support, pas le
 * support : « UC Amundi MSCI World » et « Amundi MSCI World » désignent la même
 * ligne. Les retirer est ce qui permet au rapprochement de fonctionner sur des
 * libellés saisis à deux moments différents.
 */
const WRAPPER_PREFIXES = ["uc", "etf", "support", "fonds", "part", "parts"];

/**
 * Normalise un libellé de support pour la comparaison.
 *
 * Accents retirés, ponctuation réduite à des espaces, préfixes d'habillage
 * ôtés. Le résultat n'est jamais affiché : il ne sert qu'à comparer.
 */
export function normalizeSupportName(raw: string): string {
  const base = raw
    .normalize("NFD")
    // Diacritiques : « Sécurité » et « Securite » doivent se rapprocher.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  // Plusieurs préfixes peuvent s'empiler (« UC ETF World »), d'où la boucle
  // plutôt qu'un seul retrait.
  let words = base.split(" ").filter(Boolean);
  while (words.length > 1 && WRAPPER_PREFIXES.includes(words[0]!)) {
    words = words.slice(1);
  }
  return words.join(" ");
}

/**
 * Le libellé désigne-t-il le fonds euro du contrat ?
 *
 * Le fonds euro occupe deux emplacements dans le modèle historique : le champ
 * `cashEuro` du contrat, et — très souvent — un support de la liste nommé
 * « Fonds euro X ». Ce sont les mêmes euros saisis deux fois. Sans cette
 * détection, une migration créerait deux positions et doublerait le fonds euro
 * au patrimoine.
 */
export function isEuroFundName(raw: string): boolean {
  const n = normalizeSupportName(raw);
  // « fonds euro », « fonds en euros », « euro spirica », « securite euro »…
  // Le préfixe « fonds » ayant pu être retiré par la normalisation, on teste le
  // mot « euro » comme mot entier plutôt qu'une sous-chaîne : « eurostoxx » ou
  // « euro stoxx 50 » est un support actions, pas un fonds euro.
  if (/\beuro(s)?\s+stoxx\b/.test(n) || /\beurostoxx\b/.test(n)) return false;
  return /\beuro(s)?\b/.test(n);
}

/** Support tel que saisi dans la table AV dédiée. */
export type TableSupport = {
  id: string;
  name: string;
  /** Valorisation saisie à la main, en devise du support. */
  valueEur: string;
};

/** Position issue du journal de transactions (source de vérité). */
export type LedgerSupport = {
  assetId: string;
  name: string;
  marketValueEur: string;
};

export type SupportMatch = {
  table: TableSupport;
  ledger: LedgerSupport;
  /** Clé normalisée qui a permis le rapprochement — trace d'audit. */
  key: string;
};

export type ReconcileResult = {
  /** Présents des deux côtés : comptés deux fois dans le patrimoine net. */
  duplicates: SupportMatch[];
  /** Uniquement dans la table : à migrer vers le journal. */
  tableOnly: TableSupport[];
  /** Uniquement dans le journal : rien à faire, déjà correct. */
  ledgerOnly: LedgerSupport[];
};

/**
 * Rapproche les supports d'un contrat entre la table dédiée et le journal.
 *
 * Un support du journal n'est apparié qu'une fois : si deux lignes de la table
 * portent un nom qui se normalise pareil (« UC Amundi World » et
 * « ETF Amundi World »), la première seulement est déclarée doublon. Les
 * apparier toutes deux laisserait croire qu'il faut supprimer deux lignes là où
 * le journal n'en porte qu'une.
 */
export function reconcileSupports(
  tableSupports: TableSupport[],
  ledgerSupports: LedgerSupport[]
): ReconcileResult {
  const byKey = new Map<string, LedgerSupport[]>();
  for (const l of ledgerSupports) {
    const key = normalizeSupportName(l.name);
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(l);
    else byKey.set(key, [l]);
  }

  const duplicates: SupportMatch[] = [];
  const tableOnly: TableSupport[] = [];
  const consumed = new Set<string>();

  for (const t of tableSupports) {
    const key = normalizeSupportName(t.name);
    const candidates = key ? byKey.get(key) : undefined;
    const match = candidates?.find((c) => !consumed.has(c.assetId));
    if (match) {
      consumed.add(match.assetId);
      duplicates.push({ table: t, ledger: match, key });
    } else {
      tableOnly.push(t);
    }
  }

  const ledgerOnly = ledgerSupports.filter((l) => !consumed.has(l.assetId));

  return { duplicates, tableOnly, ledgerOnly };
}

/**
 * Le fonds euro de ce contrat a-t-il déjà été repris ?
 *
 * La migration posait cette question au seul panier `tableOnly` — les supports
 * restant à migrer. Or un fonds euro déjà repris est par construction ailleurs :
 * dans `duplicates` s'il figure des deux côtés, dans `ledgerOnly` s'il n'existe
 * plus qu'au journal. Le panier interrogé était donc le seul où il ne pouvait
 * pas se trouver, et le champ `cashEuro` du contrat créait une position en trop.
 *
 * ## Pourquoi un ensemble d'identifiants de contrat
 *
 * Les positions du journal sont rapprochées contre un pool commun à tous les
 * contrats — il le faut, rien ne relie techniquement un contrat de la table à
 * une plateforme du journal. Mais cela interdit de chercher « un fonds euro
 * quelque part au journal » : la réponse serait vraie pour un contrat qui n'en
 * a pas, et solderait un `cashEuro` légitime.
 *
 * L'appartenance se lit sur `LifeInsuranceSupport` — `lifeInsuranceId` dit à
 * quel contrat, `kind` dit ce que c'est. Une clé étrangère et un champ typé,
 * là où le nom n'est qu'une présomption et le montant un faux ami : 15 200 €
 * de champ et 25 500 € de position désignent le même poste.
 */
export function euroFundAlreadyTaken(input: {
  contractId: string;
  /** Supports restant à migrer pour ce contrat. */
  tableOnly: readonly TableSupport[];
  /** Contrats portant déjà un support `FONDS_EURO` au journal. */
  contractsWithLedgerEuroFund: ReadonlySet<string>;
}): boolean {
  if (input.contractsWithLedgerEuroFund.has(input.contractId)) return true;
  // Repli historique : la liste de supports à migrer en porte souvent un, que
  // la migration créera de toute façon — inutile d'en ajouter un second.
  return input.tableOnly.some((t) => isEuroFundName(t.name));
}
