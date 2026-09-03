import type { ParsedCsv } from "./csv-parse";
import { normalizeHeader } from "./csv-parse";
import {
  extractCurrencyHint,
  inferDecimalSeparator,
  parseDate,
  parseNumber,
  toIsoLocal,
  type DecimalSeparator,
} from "./normalize";
import {
  getFormat,
  guessAssetClass,
  inferAssetFromDescription,
  mapTxType,
  normalizeTicker,
  resolveColumnMap,
  type ImportFormatId,
} from "./presets";
import type { TxType } from "../accounting/types";

export type ImportDraftRow = {
  line: number;
  selected: boolean;
  status: "ok" | "warning" | "error";
  errors: string[];
  warnings: string[];
  type: TxType | null;
  occurredAt: string | null;
  ticker: string | null;
  name: string | null;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  currency: string;
  cashAmount: string | null;
  notes: string | null;
  /** Nom plateforme détecté dans le CSV (sinon destination import). */
  platformName: string | null;
  assetClass: "ACTIONS" | "CRYPTO" | "IMMOBILIER" | "OBLIGATIONS" | "CASH" | "AUTRE";
  raw: Record<string, string>;
};

function getByRole(
  row: Record<string, string>,
  map: Record<string, string>,
  role: string
): string {
  for (const [header, r] of Object.entries(map)) {
    if (r === role) return row[header] ?? "";
  }
  return "";
}

/** Fiat codes that should not be treated as crypto tickers */
const FIAT = new Set([
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "TRY",
  "BRL",
  "MXN",
  "INR",
  "KRW",
  "CNY",
  "HKD",
  "SGD",
  "NZD",
  "ZAR",
]);

function parseQtyField(
  qtyRaw: string,
  decimalSeparator?: DecimalSeparator
): number | null {
  let qty = parseNumber(qtyRaw, decimalSeparator);
  if (qty == null && qtyRaw) {
    const m = qtyRaw.replace(/\s/g, "").match(/^([\d.,]+)([A-Za-z]+)?$/);
    if (m) qty = parseNumber(m[1], decimalSeparator);
  }
  return qty;
}

/** Colonnes numériques dont on déduit le séparateur décimal du fichier. */
const NUMERIC_ROLES = ["quantity", "unitPrice", "fees", "cashAmount"] as const;

/** Marqueur de jambe posé par `expandCryptocomConversions`. */
const LEG_KEY = "__leg";

/**
 * Crypto.com — une conversion crypto↔crypto est deux opérations, pas une.
 *
 * « EGLD -> USDC » tient sur une seule ligne : `Currency`/`Amount` portent
 * l'actif cédé (−4,15 EGLD), `To Currency`/`To Amount` l'actif reçu
 * (150,865358 USDC), et `Native Amount` la contre-valeur des deux en devise du
 * compte (143,33 €). Lue comme une opération unique, la ligne mélangeait les
 * deux jambes : la quantité de l'actif cédé se retrouvait attribuée à l'actif
 * reçu, avec un cours qui n'était le cours d'aucun des deux.
 *
 * La ligne est donc dédoublée avant le mapping : une vente et un achat, de
 * même contre-valeur. La somme des deux jambes est nulle en trésorerie —
 * aucune liquidité n'est créée, ce que la lecture en achat seul faisait.
 */
function expandCryptocomConversions(
  rows: Record<string, string>[]
): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const raw of rows) {
    const kind = raw["Transaction Kind"] ?? "";
    const toCurrency = (raw["To Currency"] ?? "").trim();
    const toAmount = (raw["To Amount"] ?? "").trim();
    if (/^crypto_exchange$/i.test(kind.trim()) && toCurrency && toAmount) {
      out.push({ ...raw, [LEG_KEY]: "sell" });
      out.push({ ...raw, [LEG_KEY]: "buy" });
      continue;
    }
    out.push(raw);
  }
  return out;
}

/**
 * Coinbase — une conversion est deux opérations, comme chez Crypto.com.
 *
 * `Transaction Type = Convert` ne colonne que l'actif cédé : `Asset` et
 * `Quantity Transacted` portent les 5,003 NU sortis, jamais les 1,185 CGLD
 * reçus. La ligne était donc lue comme un **achat de NU** — l'actif qu'elle
 * fait sortir : le portefeuille en gagnait au lieu d'en perdre, et ne recevait
 * jamais la contrepartie.
 *
 * Les deux jambes sont écrites en clair dans `Notes` : « Converted 5,00333556
 * NU to 1,18512376 CGLD » — avec la virgule décimale française. Elles sont
 * séparées en une vente et un achat de même contre-valeur, l'opération restant
 * ainsi neutre en trésorerie.
 */
const COINBASE_CONVERSION =
  /Converted\s+([\d.,]+)\s+([A-Za-z0-9]+)\s+to\s+([\d.,]+)\s+([A-Za-z0-9]+)/i;

function expandCoinbaseConversions(
  rows: Record<string, string>[]
): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const raw of rows) {
    const estConversion = /^convert$/i.test(
      (raw["Transaction Type"] ?? "").trim()
    );
    if (estConversion && COINBASE_CONVERSION.test(raw["Notes"] ?? "")) {
      out.push({ ...raw, [LEG_KEY]: "sell" });
      out.push({ ...raw, [LEG_KEY]: "buy" });
      continue;
    }
    out.push(raw);
  }
  return out;
}

/**
 * Trading 212 — quatre lignes sur treize sont décalées d'une colonne.
 *
 * Sur les opérations sur titres (`Stock distribution`, `Transfer out`, `Stock
 * split close/open`), l'export insère l'identifiant de l'ordre juste après le
 * nom, là où le fichier attend `No. of shares`. Tout ce qui suit glisse alors
 * de deux rangs : la quantité se lit comme un cours, le cours comme une
 * devise, et le montant disparaît.
 *
 * Le décalage se reconnaît sans ambiguïté — un identifiant `EOF…` là où seul
 * un nombre de titres peut figurer — et se répare en retirant les deux cellules
 * intruses. La vérification tient dans une multiplication : 595 × 3,41943 =
 * 2 034,56, le montant qu'annonce la ligne une fois réalignée.
 */
function realignTrading212Rows(
  headers: string[],
  rows: Record<string, string>[]
): Record<string, string>[] {
  const colShares = headers.indexOf("No. of shares");
  const colPrice = headers.indexOf("Price / share");
  const colId = headers.indexOf("ID");
  if (colShares < 0 || colPrice !== colShares + 1) return rows;

  return rows.map((raw) => {
    if ((raw[headers[colShares]!] ?? "").trim()) return raw;
    const intrus = (raw[headers[colPrice]!] ?? "").trim();
    if (!/^EOF\d+$/.test(intrus)) return raw;

    // Les valeurs reprennent deux rangs plus loin ; la queue remonte d'autant.
    const valeurs = headers.map((h) => raw[h] ?? "");
    valeurs.splice(colShares, 2);
    const corrige: Record<string, string> = {};
    headers.forEach((h, i) => {
      corrige[h] = valeurs[i] ?? "";
    });
    if (colId >= 0) corrige[headers[colId]!] = intrus;
    return corrige;
  });
}

/**
 * XTB — le relevé répète certaines opérations à l'identique.
 *
 * Trois achats du 14 mai figurent deux fois, mêmes identifiant, horodatage,
 * symbole, libellé et montant. Les importer tous ajouterait 99 € de titres qui
 * n'ont jamais été achetés.
 *
 * La comparaison porte sur la ligne entière, pas sur le seul identifiant :
 * l'ordre 419846716 apparaît lui aussi deux fois, mais en achat puis en vente
 * — deux opérations bien réelles que la clé plus large distingue.
 */
function dedupeXtbRows(
  rows: Record<string, string>[]
): Record<string, string>[] {
  const vues = new Set<string>();
  return rows.filter((raw) => {
    const cle = JSON.stringify(raw);
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}

export function mapCsvToDrafts(
  csv: ParsedCsv,
  formatId: ImportFormatId | string,
  options?: { columnMapOverride?: Record<string, string> | null }
): { rows: ImportDraftRow[]; columnMap: Record<string, string>; formatLabel: string } {
  const columnMap = resolveColumnMap(
    csv.headers,
    formatId,
    options?.columnMapOverride as Parameters<typeof resolveColumnMap>[2]
  ) as Record<string, string>;
  const formatLabel = getFormat(formatId as ImportFormatId).label;
  const rows: ImportDraftRow[] = [];

  // Séparateur décimal déduit une fois pour tout le fichier : `1,000` seul est
  // indécidable (1 en FR, 1000 en EN) et était systématiquement lu en décimal
  // FR — un export EN sans centimes se retrouvait divisé par 1000. Les colonnes
  // numériques sont mises en commun car un même CSV n'emploie qu'une locale.
  const sourceRows =
    formatId === "cryptocom"
      ? expandCryptocomConversions(csv.rows)
      : formatId === "coinbase"
        ? expandCoinbaseConversions(csv.rows)
      : formatId === "trading212"
        ? realignTrading212Rows(csv.headers, csv.rows)
        : formatId === "xtb"
          ? dedupeXtbRows(csv.rows)
          : csv.rows;

  /*
    eToro — la devise du compte se lit dans l'intitulé de colonne.

    Le relevé n'a pas de colonne de devise : les montants sont libellés dans la
    devise du compte, et les versions récentes l'inscrivent dans l'en-tête —
    « Amount in (USD) », « Balance in (EUR) ». C'est la seule source valable du
    fichier.

    `Details` (« NKE/USD », « KER/EUR ») n'en est pas une : c'est la devise de
    cotation de l'instrument. Le relevé porte un solde unique qui traverse
    indifféremment des lignes NKE/USD et KER/EUR — un même solde ne peut pas
    être à la fois en euros et en dollars.

    Rien n'est deviné : un en-tête nu (« Amount ») ne donne aucune devise, et
    c'est ce cas-là, et lui seul, que l'avertissement signale.
  */
  const deviseCompteEtoro =
    formatId === "etoro"
      ? extractCurrencyHint(
          ...csv.headers.filter((h) => /^\s*amount\b/i.test(h)),
          ...csv.headers.filter((h) => /^\s*balance\b/i.test(h))
        )
      : null;

  const decimalSeparator = inferDecimalSeparator(
    NUMERIC_ROLES.flatMap((role) =>
      sourceRows.map((raw) => getByRole(raw, columnMap, role))
    )
  );

  sourceRows.forEach((raw, idx) => {
    const line = idx + 2; // header is line 1
    const errors: string[] = [];
    const warnings: string[] = [];

    const dateRaw = getByRole(raw, columnMap, "date");
    let typeRaw = getByRole(raw, columnMap, "type");
    let sideRaw = getByRole(raw, columnMap, "side");
    let tickerRaw = getByRole(raw, columnMap, "ticker");
    const nameRaw = getByRole(raw, columnMap, "name");
    const qtyRaw = getByRole(raw, columnMap, "quantity");
    const priceRaw = getByRole(raw, columnMap, "unitPrice");
    const feesRaw = getByRole(raw, columnMap, "fees");
    let currencyRaw = getByRole(raw, columnMap, "currency");
    const cashRaw = getByRole(raw, columnMap, "cashAmount");
    let notesRaw = getByRole(raw, columnMap, "notes");
    // Quantité imposée par une jambe synthétique (conversion Crypto.com).
    let qtyOverride: string | null = null;
    // Cours imposé par un libellé libre (XTB).
    let priceOverride: string | null = null;
    // Montant imposé quand la colonne « quantité » porte en fait une somme.
    let cashOverride: string | null = null;
    /*
      Colonnes de remplissage : présentes dans le fichier mais dénuées de sens
      sur la ligne. Les distinguer d'une absence permet de les écarter sans
      les confondre avec une donnée manquante.
    */
    let qtySansObjet = false;
    let prixSansObjet = false;
    const classRaw = getByRole(raw, columnMap, "assetClass");
    let descriptionRaw = getByRole(raw, columnMap, "description");
    const productRaw = getByRole(raw, columnMap, "product");
    const platformRaw = getByRole(raw, columnMap, "platform");

    // ── Interactive Brokers (trades plats ou Activity Statement aplati) ───
    if (formatId === "interactive_brokers") {
      // side déjà BUY/SELL/DIVIDEND/DEPOSIT/WITHDRAWAL depuis ibkr-activity
      if (!typeRaw && sideRaw) {
        typeRaw = sideRaw;
      }
      // Asset class Stocks/Actions → ACTIONS (classRaw lu plus bas via forcedClass)
      if (!classRaw) {
        const ac = String(
          (raw as Record<string, string>).AssetClass ||
            (raw as Record<string, string>).assetclass ||
            ""
        );
        if (/stock|action|equity|share/i.test(ac)) {
          (raw as Record<string, string>).__ibkr_class = "ACTIONS";
        }
      }
      if (!currencyRaw) currencyRaw = "EUR";
    }

    /*
      eToro — l'actif est écrit dans `Details`, sous la forme « NKE/USD ».

      La partie droite est la devise de cotation de l'instrument, pas celle du
      compte : le relevé d'activité n'indique nulle part en quelle devise sont
      libellés `Amount` et `Balance`. Elle est donc lue comme identifiant
      d'actif seulement, jamais comme devise de l'opération — l'y confondre
      aurait fait passer un dividende Kering pour un flux en euros sur un
      compte en dollars.

      « - » et « Daily » ne désignent aucun actif : ce sont les remplissages des
      lignes de trésorerie et des frais de portage.
    */
    if (formatId === "etoro") {
      const details = descriptionRaw.trim();
      const remplissage = !details || /^(-|daily)$/i.test(details);
      // « - » et « Daily » ne nomment aucun actif : les laisser passer aurait
      // fait apparaître un titre nommé « Daily » dans le portefeuille.
      if (remplissage) descriptionRaw = "";
      if (!tickerRaw && !remplissage) {
        const paire = details.match(/^([A-Za-z0-9._-]+)\/[A-Za-z]{3}$/);
        if (paire) tickerRaw = paire[1]!;
      }

      /*
        La devise lue dans l'en-tête vaut pour tous les montants du fichier.
        Quand l'en-tête ne la porte pas, elle reste inconnue : le repli
        générique retiendra l'euro, ce qui est faux pour un compte en dollars —
        d'où l'avertissement, qui ne se déclenche que dans ce cas.
      */
      if (!currencyRaw && deviseCompteEtoro) {
        currencyRaw = deviseCompteEtoro;
      }
      if (!currencyRaw) {
        warnings.push(
          "Devise du compte absente de l'export eToro — vérifier avant import"
        );
      }
      /*
        « Overnight refund » est le remboursement d'un frais de portage. Le
        repli libre en faisait un APPORT, c'est-à-dire un versement au
        portefeuille : la performance s'en trouvait diminuée d'autant. Le
        modèle ne sait pas représenter un frais négatif ; plutôt que de choisir
        un type approchant, la ligne reste non typée — limitation assumée.
      */
      if (/^overnight refund$/i.test(typeRaw.trim())) {
        warnings.push(
          "Remboursement de frais eToro — non représentable, ligne ignorée"
        );
        typeRaw = "";
      }
    }

    /*
      Saxo — c'est `Event` qui décrit l'opération, pas `Type`.

      `Type` ne donne que la famille (« Trade », « Cash Transfer »…) ; quatre
      lignes sur cinq y porteraient le même mot. L'opération vraie est dans
      `Event` : « Buy 3 @ 139.74 USD », « Dividend », « Deposit », « Custody
      Fee » — y compris en néerlandais (« Koop 1.5 @ 110.01 EUR »).
    */
    if (formatId === "saxo") {
      if (descriptionRaw) typeRaw = descriptionRaw;

      /*
        `Conversion Rate` donne le taux vers la devise du compte — que le
        relevé ne nomme jamais. Quand il vaut 1, montant et instrument sont
        dans la même devise et il n'y a pas d'ambiguïté ; sinon, rien ne dit
        si `Amount` est déjà converti ou non. Le montant est conservé tel quel,
        dans la devise de l'instrument, et le doute est signalé plutôt que
        tranché au hasard.
      */
      const taux = parseNumber(raw["Conversion Rate"], decimalSeparator);
      if (taux != null && taux !== 1) {
        warnings.push(
          `Taux de conversion ${taux} appliqué par Saxo — devise du montant à vérifier`
        );
      }
    }

    /*
      Swissquote — hors achat et vente, `Quantity` vaut 1.0 et ne compte pas.

      Le relevé remplit ces deux colonnes pour toutes les lignes : un dividende
      s'y lit « Quantity 1.0, Unit price 1348.24 ». Prises au mot, elles
      créaient une position d'une part au cours de 1 348 € à chaque dividende,
      chaque frais de garde et chaque retrait. Seul `Net Amount` a un sens sur
      ces lignes.
    */
    if (formatId === "swissquote") {
      if (!/^(buy|sell)$/i.test(typeRaw.trim())) {
        qtySansObjet = true;
        prixSansObjet = true;
      }

      /*
        « Forex credit » / « Forex debit » sont les deux jambes d'un change du
        compte : 106 017,30 USD débités contre 100 000 CHF crédités. Importer
        les deux compterait deux fois le même mouvement, une fois dans chaque
        sens. Le solde en devises du compte n'est pas ce que Patrimo suit.
      */
      if (/^forex\s+(credit|debit)$/i.test(typeRaw.trim())) {
        warnings.push("Opération de change Swissquote — ignorée");
        typeRaw = "";
      }

      /*
        « Interests » peut être un crédit comme un débit : ici −0,01 CHF, un
        intérêt débiteur. Typé INTERET sans regarder le signe, il serait entré
        en revenu alors que c'est une charge — la même inversion que sur les
        impôts Avanza et DEGIRO. Le signe de `Net Amount` tranche.
      */
      if (/^interests?$/i.test(typeRaw.trim())) {
        const net = parseNumber(cashRaw, decimalSeparator);
        if (net != null && net < 0) typeRaw = "FRAIS";
      }

      // « Debit » désigne un retrait d'espèces, jamais un achat de titre.
      if (/^debit$/i.test(typeRaw.trim())) typeRaw = "RETRAIT";
      if (/^credit$/i.test(typeRaw.trim())) typeRaw = "APPORT";
    }

    /*
      XTB — la transaction est écrite dans `Comment`, pas colonnée.

      « OPEN BUY 34/42.5658 @ 11.7480 » : 34 titres exécutés sur un ordre de
      42,5658, au cours de 11,748. Seul le nombre avant la barre appartient à
      cette ligne — prendre le second donnerait la taille de l'ordre entier,
      soit ici vingt fois trop.

      Le relevé n'a aucune colonne de devise et XTB tient des comptes en EUR,
      USD, PLN, GBP ou HUF : la devise est donc réellement inconnue, et la
      ligne le dit plutôt que de laisser le repli générique décider.
    */
    if (formatId === "xtb") {
      const m = descriptionRaw.match(
        /\b(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([\d.,]+)(?:\/[\d.,]+)?\s*@\s*([\d.,]+)/i
      );
      if (m) {
        qtyOverride = m[1]!;
        priceOverride = m[2]!;
      }
      if (!currencyRaw) {
        warnings.push(
          "Devise du compte absente de l'export XTB — vérifier avant import"
        );
      }

      const libelle = typeRaw.trim();
      const montant = parseNumber(cashRaw, decimalSeparator);

      /*
        Le signe de `Amount` prime sur le libellé, comme partout ailleurs.

        Le relevé contient un « Dividend » de −0,05 (ajustement de dividende
        sur CFD indiciel, donc un débit) et une « Withholding tax » de +0,37
        (une restitution). Typés sur le seul mot, ils entraient l'un en revenu
        et l'autre en charge — les deux à l'envers.
      */
      if (/^dividend$/i.test(libelle) && montant != null && montant < 0) {
        typeRaw = "FRAIS";
      }
      /*
        Les corrections d'intérêts vont dans les deux sens : « Corr Free-funds
        Interest 2024-08 » vaut −0,50. Reprise d'un intérêt versé à tort, ce
        n'est pas un revenu.
      */
      if (
        /^free funds interests$/i.test(libelle) &&
        montant != null &&
        montant < 0
      ) {
        typeRaw = "FRAIS";
      }
      if (
        /^withholding tax$/i.test(libelle) &&
        montant != null &&
        montant > 0
      ) {
        warnings.push(
          "Restitution de retenue à la source — non représentable, ligne ignorée"
        );
        typeRaw = "";
      }

      /*
        Résultats de CFD et opérations sur titres que le modèle ne sait pas
        représenter. Plutôt que de les ranger dans un type approchant — un
        `Spin off` en APPORT gonflerait les versements et minorerait d'autant
        la performance mesurée —, la ligne reste non typée.
      */
      if (/^(profit\/loss \(fx\/cfd\)|swap|spin off)$/i.test(libelle)) {
        warnings.push(
          `Opération « ${libelle} » non représentable — ligne ignorée`
        );
        typeRaw = "";
      }
    }

    /*
      Trading 212 — le cours et le montant ne sont pas dans la même devise.

      « 49.96 USD » pour un débit de « 1.33 EUR », et pire, « 630.11 GBX » —
      des pence — pour 17,67 €. Publier le cours tel quel comme un montant en
      euros se tromperait d'un facteur 9 dans le premier cas, de 74 000 dans le
      second. Le cours est donc abandonné, non converti : `|Total| / quantité`
      le redonne dans la devise du compte, exactement.
    */
    if (formatId === "trading212") {
      const deviseCours = (raw["Currency (Price / share)"] ?? "")
        .trim()
        .toUpperCase();
      const deviseMontant = (currencyRaw || "").trim().toUpperCase();
      if (deviseCours && deviseMontant && deviseCours !== deviseMontant) {
        warnings.push(
          `Cours exprimé en ${deviseCours} alors que le montant est en ${deviseMontant} — cours ignoré`
        );
        prixSansObjet = true;
      }
    }

    /*
      Bitpanda — ni actions ni crypto : de l'argent métal.

      `Asset class` vaut « Metal » ou « Commodity » sur 158 des 208 lignes.
      Rien dans ces mots ne renvoie à une action, mais le classement par défaut
      y menait : l'argent physique se serait retrouvé rangé avec les titres.
      Le modèle n'a pas de classe « métaux » ; AUTRE dit ce qu'on sait sans
      prétendre à ce qu'on ignore.
    */
    if (formatId === "bitpanda") {
      if (/metal|commodit/i.test(classRaw)) {
        (raw as Record<string, string>).__classe = "AUTRE";
      }

      /*
        Les 105 lignes « transfer » sont les prélèvements de frais de garde du
        plan d'épargne : montant nul, quantité nulle, et des frais libellés en
        argent métal — pas en euros. Un frais payé en nature n'est pas
        représentable ; la ligne reste un mouvement de titres, non importé, et
        le dit.
      */
      if (/^transfer$/i.test(typeRaw.trim())) {
        typeRaw = "TRANSFERT_TITRE";
        // Bitpanda écrit « - » pour une cellule sans valeur : ce n'est pas un
        // actif, et l'annoncer comme tel afficherait « frais prélevés en - ».
        const fraisEnNature = (raw["Fee asset"] ?? "").trim();
        if (
          fraisEnNature &&
          fraisEnNature !== "-" &&
          !FIAT.has(fraisEnNature.toUpperCase())
        ) {
          warnings.push(
            `Frais prélevés en ${fraisEnNature} — non représentables en trésorerie`
          );
        }
      }
    }

    /*
      Bybit — un seul de ses quatre exports décrit des actifs détenus.

      `Asset Change Details` du compte spot liste des dépôts et retraits de
      jetons : ce sont des transferts, ni ventes ni cadeaux. Les trois autres
      exports portent sur des perpétuels — levier, financement, liquidation,
      résultat de position. Patrimo ne modélise pas les dérivés : ces lignes
      sont écartées en le disant, plutôt que converties en positions qui
      n'existent pas.
    */
    if (formatId === "bybit") {
      const estDerive =
        raw["Contracts"] !== undefined || raw["Contract"] !== undefined;
      if (estDerive) {
        warnings.push(
          "Opération sur dérivés Bybit — non représentable, ligne ignorée"
        );
        typeRaw = "";
      } else if (/^user(deposit|withdrawal)$/i.test(typeRaw.trim())) {
        typeRaw = "TRANSFERT_TITRE";
      }
    }

    // ── Format-specific enrichment ──────────────────────────────────────────
    if (formatId === "revolut") {
      // Product column can be "Current", "BTC", "Savings", etc.
      if (!tickerRaw && productRaw && !/current|savings|pocket|metal|junior/i.test(productRaw)) {
        tickerRaw = productRaw;
      }
      if (descriptionRaw) {
        const inferred = inferAssetFromDescription(descriptionRaw);
        if (!tickerRaw && inferred.ticker) tickerRaw = inferred.ticker;
        if (!sideRaw && inferred.side) sideRaw = inferred.side;
      }
      // Revolut Type EXCHANGE without side → try description
      if (/^exchange$/i.test(typeRaw) && !sideRaw && descriptionRaw) {
        const inferred = inferAssetFromDescription(descriptionRaw);
        if (inferred.side) sideRaw = inferred.side;
      }
      // Card / transfer cash flows
      if (/^transfer$/i.test(typeRaw) && !sideRaw) {
        const amt = parseNumber(cashRaw, decimalSeparator);
        if (amt != null && amt > 0) typeRaw = "deposit";
        if (amt != null && amt < 0) typeRaw = "withdraw";
      }
      if (/top.?up/i.test(typeRaw)) typeRaw = "topup";
      if (/card.?payment/i.test(typeRaw)) {
        // Personal expense — skip as non-portfolio unless user wants cash out
        typeRaw = "withdraw";
      }
      /*
        Export crypto — « Send », « Receive » et « Stake » ne sont pas des
        opérations de marché.

        `Send` était typé VENTE et `Receive` REWARD : un simple transfert entre
        portefeuilles produisait donc une plus-value imposable d'un côté et une
        réception à coût nul de l'autre — deux fois faux pour un mouvement qui
        ne change ni la quantité détenue ni son prix de revient. `Stake`
        immobilise l'actif sans le céder.

        La récompense de staking, elle, reste bien un REWARD : c'est une
        quantité reçue en plus.
      */
      if (/^(send|receive|stake|unstake)$/i.test(typeRaw.trim())) {
        typeRaw = "TRANSFERT_TITRE";
      }

      // Export crypto FR : devise souvent dans Price/Value (« 1,00 CHF », « 0,35€ »)
      if (!currencyRaw) {
        const hint = extractCurrencyHint(
          priceRaw,
          cashRaw,
          feesRaw,
          notesRaw,
          descriptionRaw
        );
        if (hint) currencyRaw = hint;
      }
    }

    // ── Ledger Live (hardware wallet export) ────────────────────────────────
    if (formatId === "ledger_live") {
      const statusRaw = (() => {
        for (const [k, v] of Object.entries(raw)) {
          if (normalizeHeader(k) === "status") return v;
        }
        return "";
      })();
      if (/^failed$/i.test(statusRaw.trim())) {
        // Avertissement (pas error) : ligne désélectionnée, ne bloque pas l’import
        warnings.push("Opération Failed (Ledger) — ignorée");
      }
      const tOp = typeRaw.trim();
      if (/^fees$/i.test(tOp)) typeRaw = "fees";
      else if (/^in$/i.test(tOp)) typeRaw = "in";
      else if (/^out$/i.test(tOp)) typeRaw = "out";
      else if (/^reward$/i.test(tOp)) typeRaw = "reward";
      // Staking / bonding → TRANSFERT_TITRE (désélection auto, hors positions libres)
      else if (
        /^(delegate|undelegate|redelegate|bond|unbond|opt_in|opt_out|lock|chill|nominate|withdraw_unbonded)$/i.test(
          tOp
        )
      ) {
        typeRaw = "delegate";
      }
    }

    if (formatId === "coinbase") {
      // Asset column is crypto ticker; Spot/Price Currency is fiat
      if (tickerRaw && FIAT.has(tickerRaw.toUpperCase()) && !currencyRaw) {
        currencyRaw = tickerRaw;
        tickerRaw = "";
      }
      // Advanced trade product "BTC-EUR"
      if (tickerRaw && tickerRaw.includes("-")) {
        const [base, quote] = tickerRaw.split("-");
        tickerRaw = base;
        if (!currencyRaw && quote) currencyRaw = quote;
      }
      if (descriptionRaw || notesRaw) {
        const inferred = inferAssetFromDescription(descriptionRaw || notesRaw);
        if (!tickerRaw && inferred.ticker) tickerRaw = inferred.ticker;
        if (!sideRaw && inferred.side) sideRaw = inferred.side;
      }
      /*
        « Send » et « Receive » déplacent des jetons, ils ne les échangent pas.

        Un envoi vers un portefeuille personnel était typé VENTE : le relevé
        2022 en compte six, soit six cessions imposables fabriquées de toutes
        pièces — dont un envoi de 0,033 BTC valorisé 1 900 $. La réception
        symétrique entrait en REWARD, à prix de revient nul. Les colonnes
        `Subtotal` et `Total` sont d'ailleurs vides sur ces lignes : le relevé
        lui-même dit qu'aucune somme n'a changé de main.
      */
      if (/^(receive|send)$/i.test(typeRaw.trim())) {
        typeRaw = "TRANSFERT_TITRE";
      }

      // Jambes d'une conversion, dédoublées par `expandCoinbaseConversions`.
      const legCb = raw[LEG_KEY];
      if (legCb) {
        const m = (raw["Notes"] ?? "").match(COINBASE_CONVERSION);
        if (m) {
          if (legCb === "buy") {
            tickerRaw = m[4]!;
            qtyOverride = m[3]!;
            sideRaw = "buy";
            /*
              `Spot Price at Transaction` est le cours de l'actif **cédé** :
              le conserver ferait valoir 0,00000132 BTC au cours de l'ETH.
              Écarté, il est redéduit du montant — le seul chiffre qui vaille
              pour les deux jambes.
            */
            prixSansObjet = true;
          } else {
            tickerRaw = m[2]!;
            qtyOverride = m[1]!;
            sideRaw = "sell";
          }
          typeRaw = "";
        }
      }
      if (/reward|learning|staking\s*income|inflation/i.test(typeRaw)) {
        typeRaw = "rewards";
      }
      // Prix avec préfixe $ déjà géré par parseNumber ; s’assurer que
      // Price Currency (USD) n’écrase pas un ticker crypto
      if (currencyRaw && !FIAT.has(currencyRaw.toUpperCase()) && tickerRaw) {
        // garder currency fiat si dispo dans raw
        for (const [k, v] of Object.entries(raw)) {
          if (/price\s*currency|spot\s*price\s*currency/i.test(k) && v) {
            currencyRaw = v.replace(/[^A-Za-z]/g, "").slice(0, 3);
            break;
          }
        }
      }
    }

    // Crypto.com App (wallet / carte / fiat)
    if (formatId === "cryptocom") {
      const leg = raw[LEG_KEY];
      if (leg === "buy") {
        // Jambe reçue de la conversion : l'actif et la quantité viennent des
        // colonnes `To …`, la contre-valeur reste celle de la ligne entière.
        tickerRaw = (raw["To Currency"] ?? "").trim();
        qtyOverride = (raw["To Amount"] ?? "").trim();
        typeRaw = "";
        sideRaw = "buy";
      } else if (leg === "sell") {
        sideRaw = "sell";
        typeRaw = "";
      }

      /*
        Le signe d'`Amount` porte le sens de l'opération, et lui seul.

        « Balance Conversion » se lit sur deux lignes — `…_credited` pour
        l'actif reçu, `…_debited` pour l'actif cédé — dont seuls les signes
        diffèrent. Les deux étaient typées ACHAT : le portefeuille gagnait
        81 USDT au lieu de les perdre. Même chose pour `card_top_up`, qui est
        la cession de crypto payant une recharge de carte.
      */
      /*
        Un mouvement de portefeuille n'est ni une vente ni un cadeau.

        `crypto_withdrawal` était typé VENTE et `crypto_deposit` REWARD : le
        même jeton, sorti puis rentré, produisait une plus-value imposable d'un
        côté et un prix de revient nul de l'autre. Sur les 21 retraits du
        relevé 2022, cela fabriquait autant de cessions qui n'ont pas eu lieu.

        Même chose pour les mouvements entre poches (`…_transfer`), les
        ajustements internes (`admin_wallet_…`) et les entrées/sorties du
        Supercharger : la quantité détenue ne change pas, seul son
        emplacement.
      */
      const mouvementInterne =
        /^(crypto_withdrawal|crypto_deposit|admin_wallet_(credited|debited)|supercharger_(deposit|withdrawal)|crypto_to_exchange_transfer|exchange_to_crypto_transfer)$/i;
      if (!leg && mouvementInterne.test(typeRaw.trim())) {
        typeRaw = "TRANSFERT_TITRE";
      }

      /*
        « viban_purchase » : un achat de crypto payé en euros.

        L'actif acquis est dans `To Currency`, sa quantité dans `To Amount` —
        `Currency`/`Amount` portent l'euro dépensé. Sans cette lecture, la
        ligne remontait sans actif, avec 399,92 pour quantité : le montant en
        euros pris pour un nombre de jetons.
      */
      if (
        !leg &&
        /^viban_purchase$/i.test(typeRaw.trim()) &&
        (raw["To Currency"] ?? "").trim() &&
        (raw["To Amount"] ?? "").trim()
      ) {
        tickerRaw = (raw["To Currency"] ?? "").trim();
        qtyOverride = (raw["To Amount"] ?? "").trim();
        typeRaw = "";
        sideRaw = "buy";
      }

      /*
        « card_cashback_reverted » reprend un cashback versé à tort : la
        quantité sort du portefeuille. Typé REWARD par le mot « cashback », il
        l'y ajoutait une seconde fois.
      */
      if (!leg && /^card_cashback_reverted$/i.test(typeRaw.trim())) {
        typeRaw = "TRANSFERT_TITRE";
        warnings.push("Reprise de cashback — sortie de jetons, pas un revenu");
      }

      if (
        !leg &&
        /swap_credited|swap_debited|card_top_up|dust_conversion_credited|dust_conversion_debited/i.test(
          typeRaw
        )
      ) {
        const montant = parseNumber(qtyRaw, decimalSeparator);
        if (montant != null) {
          sideRaw = montant < 0 ? "sell" : "buy";
          typeRaw = "";
        }
      }

      // native_amount was mapped poorly to notes — recover from raw keys
      if (!currencyRaw) {
        for (const [k, v] of Object.entries(raw)) {
          if (/native.?currency/i.test(k) && v) {
            currencyRaw = v;
            break;
          }
        }
      }
      // Prefer Transaction Kind already in typeRaw
      if (!typeRaw && descriptionRaw) {
        typeRaw = descriptionRaw;
      }
      // Card cashbacks / rewards
      if (/cashback|referral|supercharger|mco_stake/i.test(typeRaw + descriptionRaw)) {
        typeRaw = "reward";
      }
    }

    // Crypto.com Deposit / Withdrawal exports
    if (formatId === "cryptocom_transfer") {
      const rawKeys = Object.keys(raw).join(" ");

      /*
        Ces exports décrivent des mouvements de portefeuille, pas des marchés.

        `DEPOSIT.csv` et `WITHDRAWAL.csv` listent les entrées et sorties de
        jetons entre Crypto.com et l'extérieur. Typé « deposit », un dépôt
        finissait en REWARD faute de contrepartie en espèces : 6 263 USDC
        entraient au portefeuille avec un prix de revient nul, et leur revente
        aurait affiché 100 % de plus-value. Ce sont des transferts.

        Le fichier `SUPERCHARGER_REWARDS.csv`, lui, décrit bien des
        récompenses — c'est le seul des trois.
      */
      const estRecompense = /supercharger|reward/i.test(rawKeys + typeRaw);
      if (estRecompense) {
        typeRaw = "reward";
      } else if (/deposit|withdrawal/i.test(rawKeys)) {
        typeRaw = "TRANSFERT_TITRE";
      } else if (!typeRaw) {
        typeRaw = "reward";
      }

      /*
        `Status` n'est pas décoratif : seules les lignes « Completed » ont eu
        lieu. Importer une opération en attente ou annulée créerait une
        position qui n'existe pas.
      */
      const statut = (raw["Status"] ?? "").trim();
      if (statut && !/^(completed|success|succeeded|ok)$/i.test(statut)) {
        warnings.push(`Opération non finalisée (${statut}) — ignorée`);
        typeRaw = "";
      }
    }

    // Nexo
    if (formatId === "nexo") {
      // Interest / rewards stay on Input Currency
      if (/interest|dividend|bonus|cashback/i.test(typeRaw)) {
        // keep ticker from input currency
      }
      if (/withdrawal/i.test(typeRaw)) typeRaw = "withdraw";
      if (/deposit/i.test(typeRaw)) typeRaw = "deposit";
      // Exchange / convert → buy of output
      if (/exchange/i.test(typeRaw) && nameRaw) {
        tickerRaw = nameRaw;
        // output amount in cashAmount role
        sideRaw = "buy";
        typeRaw = "buy";
      }
      if (/locking|transfer from savings/i.test(typeRaw + descriptionRaw)) {
        typeRaw = "transfer";
      }

      /*
        Nexo chiffre tout en dollars, jamais en euros.

        La seule contre-valeur du relevé est `USD Equivalent`, écrite
        « $2050.87 ». Sans colonne de devise reconnue, le repli générique
        retenait l'euro : chaque ligne était présentée dans une devise que le
        fichier ne mentionne nulle part, et les montants s'en trouvaient
        surévalués d'environ 10 %.
      */
      const jeton = tickerRaw.trim().toUpperCase();
      if (!currencyRaw && FIAT.has(jeton)) {
        /*
          Une ligne en euros reste en euros : quand l'actif lui-même est une
          monnaie, `Amount` est une somme, pas une quantité de jetons.
        */
        currencyRaw = jeton;
        tickerRaw = "";
        if (!cashRaw) {
          cashOverride = qtyRaw;
          qtySansObjet = true;
        }
      } else if (!currencyRaw && /usd_equivalent/i.test(
        Object.keys(raw).map(normalizeHeader).join(" ")
      )) {
        currencyRaw = "USD";
      }

      /*
        `Details` porte le statut avant la barre oblique : « approved / ETH
        Interest Earned ». Une opération rejetée ou en attente n'a pas eu lieu.
      */
      const statutNexo = (descriptionRaw.split("/")[0] ?? "").trim();
      if (statutNexo && !/^approved$/i.test(statutNexo)) {
        warnings.push(`Opération non approuvée (${statutNexo}) — ignorée`);
        typeRaw = "";
      }
    }

    // AscendEX staking / DeFi
    if (formatId === "ascendex") {
      /*
        AscendEX exporte deux fichiers par produit, et un seul décrit un gain.

        Le fichier « staking » liste les entrées et sorties de la mise
        (`Deposit`, `Regular Redemption`) et sa colonne `Size` porte le solde
        immobilisé — 2 470 CAPS. Le fichier « award » liste les récompenses,
        quelques centièmes de jeton. Faute de les distinguer, la première ligne
        du premier fichier créditait 2 470 CAPS gratuits, la suivante 2 444 de
        plus, et ainsi de suite : la mise entière comptée en revenu, autant de
        fois qu'elle a bougé.

        La colonne de statut (`Type 2`, dédoublonnée par `dedupeHeaders`) est
        ce qui les sépare : elle n'existe que sur le fichier des mouvements.
      */
      const mouvementDeMise = (raw["Type 2"] ?? "").trim();
      if (mouvementDeMise) {
        typeRaw = "TRANSFERT_TITRE";
        warnings.push(
          `Mouvement de mise (${mouvementDeMise}) — pas une récompense`
        );
      } else if (
        /reward|compound|interest|award/i.test(typeRaw + notesRaw + descriptionRaw)
      ) {
        typeRaw = "reward";
      }

      /*
        `Status` ne vaut pas toujours « Succeeded » : une mise en échec ou en
        attente n'a pas eu lieu.
      */
      const statut = (raw["Status"] ?? "").trim();
      if (statut && !/^(succeeded|success|completed|ok)$/i.test(statut)) {
        warnings.push(`Opération non finalisée (${statut}) — ignorée`);
        typeRaw = "";
      }
      if (/deposit/i.test(typeRaw + notesRaw)) typeRaw = "deposit";
      if (/redemption|withdraw/i.test(typeRaw + notesRaw)) typeRaw = "withdraw";
      // Reward cell "0.84 CAPS-S"
      if (qtyRaw && /[A-Za-z]/.test(qtyRaw)) {
        const m = qtyRaw.replace(/\s/g, "").match(/^([\d.,]+)/);
        if (m) {
          // quantity cleaned below via parseQtyField
          (raw as Record<string, string>).__ascendex_qty = m[1]!;
        }
      }
    }

    // Override qty from AscendEX reward parse
    const qtyField =
      formatId === "ascendex" && (raw as Record<string, string>).__ascendex_qty
        ? (raw as Record<string, string>).__ascendex_qty
        : qtyRaw;

    const date = parseDate(dateRaw);
    if (!date) errors.push("Date invalide ou manquante");

    let type = mapTxType(typeRaw, sideRaw || null);
    // Infer type from free text
    if (!type && nameRaw) type = mapTxType(nameRaw, null);
    if (!type && notesRaw) type = mapTxType(notesRaw, null);
    if (!type && descriptionRaw) type = mapTxType(descriptionRaw, sideRaw || null);

    /*
      DEGIRO — les jambes internes du compte espèces ne sont pas des opérations.

      Un achat en devise étrangère produit trois à quatre lignes partageant le
      même `Order Id` : la transaction elle-même, ses frais, et une paire
      « Valuta Debitering / Creditering » qui n'est que la conversion du cash.
      De même, chaque dépôt iDEAL est doublé d'une ligne « Reservation » de
      signe opposé. Importer ces contreparties compterait deux fois le même
      mouvement, une fois dans chaque sens.

      Elles ne sont donc pas typées. C'est une exclusion assumée, pas un oubli :
      le solde du compte espèces n'est pas ce que Patrimo suit.
    */
    if (formatId === "degiro" && typeRaw) {
      /*
        « … de divisa » couvre d'un coup les quatre formulations ibériques de
        la conversion de devise — Cambio, Levantamento, Crédito, Retirada —
        y compris quand l'accent a mal survécu à l'export.
      */
      const jambeInterne =
        /valuta\s+(debitering|creditering)|^fx\s+(debit|credit)|de divisa|^reservation|cash sweep|overboeking|variation fonds monetaires/i;
      const sansAccent = typeRaw
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      if (jambeInterne.test(sansAccent)) {
        warnings.push("Mouvement interne au compte espèces — ignoré");
        type = null;
      }
    }

    /*
      IBKR — une conversion de devise n'est pas une vente de titre.

      Les Flex Queries mêlent aux transactions les opérations de change du
      compte : « SELL, -8000 @ 1,1173, USD » sans ISIN, c'est-à-dire 8 000 USD
      cédés contre des CHF. Typées VENTE, elles remontaient en erreur
      (« Ticker requis ») — et si un ticker avait pu être deviné, elles
      auraient créé une position fantôme et double-compté le cash.

      L'absence d'ISIN est le signal : chez IBKR toute ligne portant un titre
      en porte un. C'est une exclusion assumée — le solde en devises du compte
      n'est pas ce que Patrimo suit.
    */
    if (
      formatId === "interactive_brokers" &&
      (type === "ACHAT" || type === "VENTE") &&
      !tickerRaw &&
      raw["ISIN"] !== undefined
    ) {
      warnings.push("Opération de change IBKR (sans ISIN) — ignorée");
      type = null;
    }

    /*
      Avanza — la colonne de type fait foi, et elle seule.

      Le repli sur le libellé libre ci-dessus sert les exports où le type n'est
      pas colonné (Revolut, Coinbase). Chez Avanza il nuit : la colonne
      `Typ av transaktion` est toujours renseignée, et quand elle vaut
      « Övrigt » — un fourre-tout —, c'est la description qui décidait. Sur
      « Avkastningsskatt » (impôt sur le rendement, −26 SEK), le libellé faisait
      conclure à un apport, et la ligne entrait au portefeuille comme +26 SEK
      de trésorerie : un débit lu comme un crédit.

      Un type déclaré mais inconnu reste donc inconnu. La ligne remonte en
      erreur et n'est pas importée, ce qui est la bonne réponse pour un
      fourre-tout qui recouvre aussi bien un remboursement de frais qu'un
      échange de parts de fonds.
    */
    if (formatId === "avanza" && typeRaw && !mapTxType(typeRaw, null)) {
      type = null;
    }

    if (!type) errors.push("Type d'opération non reconnu");

    let ticker = normalizeTicker(tickerRaw);
    // Don't use fiat as ticker
    if (ticker && FIAT.has(ticker)) {
      if (!currencyRaw) currencyRaw = ticker;
      ticker = null;
    }

    let name =
      nameRaw.trim() ||
      productRaw.trim() ||
      ticker ||
      (descriptionRaw ? descriptionRaw.slice(0, 80) : null);

    // Crypto formats default to CRYPTO class — pas les exports Invest (Price per share)
    let forcedClass: string | null =
      (raw as Record<string, string>).__classe ||
      classRaw ||
      (raw as Record<string, string>).__ibkr_class ||
      null;
    const rawKeys = Object.keys(raw);
    const isRevolutEquityExport = rawKeys.some((k) =>
      /price\s*per\s*share|total\s*amount/i.test(k)
    );
    if (
      formatId === "interactive_brokers" &&
      !forcedClass &&
      /stock|action|equity|share/i.test(classRaw || "")
    ) {
      forcedClass = "ACTIONS";
    }
    if (
      formatId === "interactive_brokers" &&
      !forcedClass &&
      type &&
      ["ACHAT", "VENTE", "DIVIDENDE"].includes(type)
    ) {
      forcedClass = "ACTIONS";
    }
    if (
      (formatId === "coinbase" ||
        formatId === "binance" ||
        formatId === "cryptocom" ||
        formatId === "cryptocom_transfer" ||
        formatId === "nexo" ||
        formatId === "ascendex" ||
        formatId === "ledger_live" ||
        (formatId === "revolut" && !isRevolutEquityExport)) &&
      ticker &&
      !forcedClass
    ) {
      forcedClass = "CRYPTO";
    }
    if (formatId === "revolut" && isRevolutEquityExport && ticker && !forcedClass) {
      forcedClass = "ACTIONS";
    }

    let qty = qtySansObjet
      ? null
      : parseQtyField(qtyOverride || qtyField || qtyRaw, decimalSeparator);
    // Crypto.com / Nexo : quantités signées
    if (qty != null && qty < 0) qty = Math.abs(qty);
    let unitPrice = prixSansObjet
      ? null
      : parseNumber(priceOverride || priceRaw, decimalSeparator);

    /*
      DEGIRO — la transaction est écrite en toutes lettres, pas en colonnes.

      Le relevé de compte ne colonne ni la quantité ni le cours : ils vivent
      dans le libellé, sous la forme « Koop 1 @ 33,9 USD » — et dans la langue
      du compte (Koop, Verkoop, Compra, Sell…), parfois préfixée par une
      opération sur titres (« STOCK DIVIDEND: Koop », « PRODUCTWIJZIGING : »).

      Seuls ces deux nombres sont lus. La devise citée en fin de libellé est
      ignorée : celle qui fait foi est la colonne `Mutatie`, qui porte la devise
      du montant réellement débité.
    */
    /*
      Saxo écrit ses transactions dans la même forme que DEGIRO — « Buy 3 @
      139.74 USD », « Koop 1.5 @ 110.01 EUR » — jusqu'aux verbes néerlandais.
      La lecture est donc partagée plutôt que dupliquée.
    */
    if (
      (formatId === "degiro" || formatId === "saxo") &&
      (qty == null || unitPrice == null)
    ) {
      /*
        Un préfixe d'opération sur titres précède parfois le verbe
        (« STOCK DIVIDEND: Koop », « Conversion … finalisée: Vente »). Ce qui
        décrit la transaction est ce qui suit le dernier deux-points.
      */
      const clause = typeRaw.split(/:(?!\d)/).pop()!.trim();
      const m = clause.match(
        /^(\p{L}+)\s+(\d[\d\s]*(?:[.,]\d+)?)\s*(?:[^@]*?)@\s*([\d\s]*\d(?:[.,]\d+)?)\s*([A-Za-z]{2,4})?/u
      );
      if (m) {
        const verbe = m[1]!.toLowerCase();
        const q = parseNumber(m[2]!.replace(/\s/g, ""), decimalSeparator);
        const p = parseNumber(m[3]!.replace(/\s/g, ""), decimalSeparator);
        const deviseCours = (m[4] || "").toUpperCase();
        const deviseMontant = (currencyRaw || "EUR").trim().toUpperCase();

        /*
          Le verbe de la clause fait foi sur le sens, pas le libellé entier :
          « Conversion … : Vente » contient deux mots typables, et le plus long
          — « conversion » — l'emportait, inversant le sens de l'opération.
        */
        if (/^(koop|compra|acquisto|achat|buy|kauf)$/.test(verbe)) type = "ACHAT";
        else if (/^(verkoop|vente|venta|vendita|sell|verkauf)$/.test(verbe)) {
          type = "VENTE";
        }

        if (qty == null && q != null && q > 0) qty = q;

        /*
          « Sell 4 AVIVA@496 GBX » : le cours est en pence, le montant en GBP.
          Publier 496 GBP se tromperait d'un facteur 100. Quand la devise citée
          au cours diffère de celle de la colonne `Mutatie`, le cours est
          abandonné plutôt que converti — |montant| / quantité le redonne dans
          la bonne unité. UNKNOWN plutôt qu'une valeur inventée.
        */
        if (deviseCours && deviseMontant && deviseCours !== deviseMontant) {
          warnings.push(
            `Cours exprimé en ${deviseCours} alors que le montant est en ${deviseMontant} — cours ignoré`
          );
        } else if (unitPrice == null && p != null) {
          unitPrice = p;
        }
      }
    }
    let fees = parseNumber(feesRaw, decimalSeparator) ?? 0;
    if (feesRaw && fees === 0) {
      const fm = feesRaw.replace(/\s/g, "").match(/^([\d.,]+)/);
      if (fm) fees = parseNumber(fm[1], decimalSeparator) ?? 0;
    }
    // Beaucoup de courtiers écrivent la commission en débit négatif (« -1,00 »).
    // Un frais est toujours un coût : `applyBuy` fait coût = qty × prix + frais,
    // donc un frais négatif *retranchait* du coût de revient — soit un écart du
    // double des frais, et une plus-value d'autant surévaluée à la revente.
    // ibkr-activity normalisait déjà de son côté (feeAbs) ; on aligne le
    // chemin générique, qui sert tous les autres courtiers.
    if (fees < 0) fees = Math.abs(fees);

    /*
      Saxo — la commission n'est pas colonnée, elle est incluse dans `Amount`.

      « Buy 3 @ 134.85 USD » pour un débit de 405,55 : 3 × 134,85 = 404,55, le
      dollar d'écart est la commission. La retrancher n'est pas une estimation
      mais une soustraction entre deux valeurs données par le fichier — sans
      quoi le prix de revient serait sous-évalué du montant des frais, et la
      plus-value d'autant surévaluée à la revente.

      Le signe garde du contresens : un achat coûte plus que son notionnel, une
      vente rapporte moins. Quand l'écart va dans l'autre sens, il n'est pas
      une commission et rien n'est déduit.
    */
    if (
      formatId === "saxo" &&
      fees === 0 &&
      (type === "ACHAT" || type === "VENTE") &&
      qty != null &&
      unitPrice != null
    ) {
      const brut = qty * unitPrice;
      const net = parseNumber(cashRaw, decimalSeparator);
      if (net != null && brut > 0) {
        const ecart = type === "ACHAT" ? Math.abs(net) - brut : brut - Math.abs(net);
        // Les montants du fichier ont deux décimales : au-delà, ce qui reste
        // est du bruit de virgule flottante, pas une fraction de centime.
        if (ecart > 0) fees = Math.round(ecart * 1e6) / 1e6;
      }
    }

    let cashAmount = parseNumber(cashOverride ?? cashRaw, decimalSeparator);
    // Revolut Amount is often signed
    if (cashAmount != null && cashAmount < 0) {
      if (type === "RETRAIT" || type === "FRAIS" || type === "VENTE") {
        cashAmount = Math.abs(cashAmount);
      } else if (type === "ACHAT" || type === "APPORT") {
        cashAmount = Math.abs(cashAmount);
      }
    }

    /*
      Avanza / BUX / Bitvavo — colonnes lues hors mapping.

      Devise d'instrument, statut, devise de frais : trois informations qui ne
      portent pas de rôle de colonne mais décident de la validité d'une ligne.
      Elles sont donc lues directement sur la ligne brute, comme le fait déjà
      le bloc Ledger Live pour son statut.
    */
    const rawCol = (nom: string): string => {
      for (const [k, v] of Object.entries(raw)) {
        if (normalizeHeader(k) === nom) return String(v ?? "").trim();
      }
      return "";
    };

    /*
      Avanza — le cours n'est pas exprimé dans la devise du montant.

      `Kurs` est en devise de l'instrument, `Belopp` en devise du compte, et
      `Valutakurs` fait le lien. Publier les deux ensemble donnerait un prix
      unitaire faux d'un facteur de change : une action S&P Global à 330 USD
      s'afficherait à 330 SEK, soit dix fois moins que ce qu'elle a coûté.

      Le montant est le fait comptable — c'est lui qu'on garde. Le prix se
      redéduit plus bas par `|montant| / quantité`, donc dans la bonne devise.
    */
    if (formatId === "avanza" && unitPrice != null) {
      const instrument = rawCol("instrumentvaluta").toUpperCase();
      const transaction = rawCol("transaktionsvaluta").toUpperCase();
      if (instrument && transaction && instrument !== transaction) {
        unitPrice = null;
      }
    }

    /*
      BUX — même situation, sous d'autres noms.

      `Asset Price` peut être en dollars quand `Transaction Amount` est en
      euros ; `Exchange Rate` porte le taux. Même arbitrage que pour Avanza.
    */
    if (formatId === "bux" && unitPrice != null) {
      const asset = rawCol("asset_currency").toUpperCase();
      const transaction = rawCol("transaction_currency").toUpperCase();
      if (asset && transaction && asset !== transaction) {
        unitPrice = null;
      }
    }

    if (formatId === "bitvavo") {
      /*
        Une ligne non aboutie n'est pas une transaction.

        L'export mêle les opérations exécutées (`Completed`) et les
        distributions de staking (`Distributed`) à d'éventuelles lignes en
        cours ou annulées. Importer ces dernières comme des faits ferait entrer
        au portefeuille des quantités qui n'ont jamais bougé.
      */
      const statut = rawCol("status");
      if (statut && !/^(completed|distributed)$/i.test(statut)) {
        warnings.push(`Statut « ${statut} » — opération non aboutie, ignorée`);
        type = null;
      }

      /*
        Frais prélevés dans une autre devise que la transaction.

        Un retrait de BTC paie ses frais en BTC, pas en euros. Les reporter
        tels quels dans un champ que le moteur lit en devise de transaction
        écrirait 0,00003 € au lieu de 0,00003 BTC — un chiffre faux plutôt
        qu'une donnée manquante. On les écarte, et on le dit.
      */
      // Même défaut que la résolution de devise en aval : sur un retrait, la
      // colonne de cotation est vide et l'opération est lue en euros.
      const deviseOperation = (currencyRaw || "EUR").trim().toUpperCase();
      const deviseFrais = rawCol("fee_currency").toUpperCase();
      if (fees > 0 && deviseFrais && deviseFrais !== deviseOperation) {
        warnings.push(
          `Frais en ${deviseFrais}, hors devise de l'opération — non repris`
        );
        fees = 0;
      }
    }

    // Ledger Live : frais réseau en crypto (qty = fees) → VENTE de qty
    if (
      formatId === "ledger_live" &&
      type === "FRAIS" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      type = "VENTE";
      if (unitPrice == null && cashAmount != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
      }
      unitPrice = unitPrice ?? 0;
      fees = 0;
      cashAmount = null;
      // pas de warning bulk (sinon 800+ lignes « avertissement » en UI)
    }

    // Ledger Live : opérations contractuelles à qty 0 (approve, claim vide…)
    // → désélection + warning (pas error, pour ne pas afficher « 194 erreurs »)
    let ledgerSkipNoQty = false;
    if (
      formatId === "ledger_live" &&
      (qty == null || qty === 0) &&
      type &&
      ["APPORT", "RETRAIT", "FRAIS", "REWARD", "ACHAT", "VENTE"].includes(type)
    ) {
      warnings.push("Sans mouvement de quantité — ignorée");
      ledgerSkipNoQty = true;
      type = null; // évite les validations cash/qty en aval
    }

    // Trades without explicit cash
    if (
      type &&
      ["ACHAT", "VENTE"].includes(type) &&
      cashAmount == null &&
      qty != null &&
      unitPrice != null
    ) {
      cashAmount = qty * unitPrice;
    }

    // Infer price from total/qty
    if (
      type &&
      ["ACHAT", "VENTE"].includes(type) &&
      unitPrice == null &&
      qty != null &&
      qty !== 0 &&
      cashAmount != null
    ) {
      unitPrice = Math.abs(cashAmount / qty);
      if (formatId !== "ledger_live") {
        warnings.push("Prix unitaire déduit du montant total");
      }
    }

    // Staking / rewards en tokens → type REWARD (+qty, coût 0, pas un achat).
    // Prix marché optionnel (affichage FMV) ; INTERET avec qty crypto bascule aussi en REWARD.
    if (
      type === "INTERET" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      type = "REWARD";
      if (unitPrice == null && cashAmount != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
        warnings.push(
          "Valeur marché indicative déduite du montant (staking / reward)"
        );
      }
      unitPrice = unitPrice ?? 0;
      warnings.push(
        "Récompense crypto → Staking / reward (quantité gratuite, hors achat)"
      );
    }

    // REWARD : normaliser qty / FMV optionnelle
    if (type === "REWARD") {
      if (unitPrice == null && cashAmount != null && qty != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
        if (formatId !== "ledger_live") {
          warnings.push("Valeur marché indicative déduite du montant");
        }
      }
      unitPrice = unitPrice ?? 0;
      // Pas de cash dépensé
      cashAmount = null;
    }

    // Réception crypto (Revolut « Réception », Ledger « IN », Receive…) :
    // ce n'est PAS un apport cash — entrée de quantité en REWARD (coût 0).
    // FMV (Price/Value) = info d’affichage uniquement, pas un ACHAT.
    // ACHAT uniquement si le type source est clairement un achat/purchase.
    if (
      type === "APPORT" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      const hay = `${typeRaw} ${notesRaw} ${descriptionRaw} ${nameRaw}`;
      const buyHint =
        /^(buy|achat|purchase)$/i.test((typeRaw || "").trim()) ||
        /crypto_purchase|viban_purchase|bought|acquisition/i.test(hay);
      if (buyHint) {
        type = "ACHAT";
        if (unitPrice == null && cashAmount != null && qty !== 0) {
          unitPrice = Math.abs(cashAmount / qty);
        }
        unitPrice = unitPrice ?? 0;
        cashAmount = null;
        warnings.push("Dépôt crypto type achat → Achat (entrée de position)");
      } else {
        type = "REWARD";
        if (unitPrice == null && cashAmount != null && qty !== 0) {
          unitPrice = Math.abs(cashAmount / qty);
          if (formatId !== "ledger_live") {
            warnings.push(
              "Valeur marché indicative déduite du montant (réception)"
            );
          }
        }
        unitPrice = unitPrice ?? 0;
        cashAmount = null;
        if (formatId !== "ledger_live") {
          // Le libellé doit énoncer la conséquence : une réception est importée
          // avec un coût d'acquisition nul. C'est exact pour un staking / airdrop,
          // mais faux pour un transfert d'actifs déjà détenus — auquel cas la
          // position afficherait 100 % de plus-value et gonflerait l'estimation
          // fiscale à la revente. L'utilisateur doit pouvoir trancher.
          warnings.push(
            "Réception crypto → coût d'acquisition 0 (staking / reward). " +
              "S'il s'agit d'un transfert d'actifs déjà détenus, corrigez le prix " +
              "de revient : sinon la revente comptera 100 % de plus-value."
          );
        }
      }
    }

    // Retrait crypto (envoi) → VENTE ledger (baisse stock) ; note retrait-crypto (UX).
    if (
      type === "RETRAIT" &&
      ticker &&
      qty != null &&
      qty > 0 &&
      !FIAT.has(ticker)
    ) {
      type = "VENTE";
      if (unitPrice == null && cashAmount != null && qty !== 0) {
        unitPrice = Math.abs(cashAmount / qty);
      }
      unitPrice = unitPrice ?? 0;
      cashAmount = null;
      notesRaw = notesRaw
        ? `${notesRaw} | retrait-crypto`
        : "retrait-crypto (sortie de portefeuille)";
    }

    let currency = (currencyRaw || "EUR").trim().toUpperCase() || "EUR";
    if (currency.length > 3) currency = currency.slice(0, 3);
    if (!/^[A-Z]{3}$/.test(currency)) {
      currency = "EUR";
      warnings.push("Devise invalide → EUR");
    }

    const assetClass = guessAssetClass(ticker, name, forcedClass);

    if (type && ["ACHAT", "VENTE"].includes(type)) {
      if (!ticker && !name) errors.push("Ticker ou nom d'actif requis");
      if (qty == null || qty <= 0) errors.push("Quantité positive requise");
      if (unitPrice == null || unitPrice < 0) errors.push("Prix unitaire requis");
    }

    if (type === "REWARD") {
      if (!ticker && !name) errors.push("Ticker ou nom d'actif requis");
      if (qty == null || qty <= 0) errors.push("Quantité positive requise");
      if (unitPrice != null && unitPrice < 0) {
        errors.push("Valeur marché indicative invalide");
      }
    }

    if (
      type &&
      ["APPORT", "RETRAIT", "FRAIS", "INTERET", "DIVIDENDE", "COUPON", "LOYER"].includes(type)
    ) {
      if (cashAmount == null || cashAmount <= 0) {
        if (cashAmount != null && cashAmount < 0) cashAmount = Math.abs(cashAmount);
        else if (qty != null && unitPrice != null) cashAmount = Math.abs(qty * unitPrice);
        else errors.push("Montant cash requis");
      }
      if (!name && ticker) name = ticker;
    }

    // Skip non-portfolio Revolut noise
    if (formatId === "revolut" && /card.?payment|atm|fee.*revolut/i.test(typeRaw + descriptionRaw)) {
      if (type === "RETRAIT" && !ticker) {
        warnings.push("Paiement carte / ATM — hors portefeuille titres (décoché)");
      }
    }

    if (type === "TRANSFERT_CASH" || type === "TRANSFERT_TITRE") {
      // Ledger staking ops : un seul message court, pas de flood
      if (formatId === "ledger_live") {
        warnings.push("Staking / bonding — non importé (hors positions libres)");
      } else {
        warnings.push(
          "Transferts non importés automatiquement (ignorés au commit)"
        );
      }
    }

    // Skip failed / pending Revolut states
    if (/^reverted$|^failed$|^pending$/i.test(notesRaw) || /^reverted$|^failed$/i.test(typeRaw)) {
      errors.push("Opération non finalisée (pending/failed) — ignorée");
    }

    // Ne pas marquer Failed générique si déjà géré Ledger
    if (
      formatId === "ledger_live" &&
      warnings.some((w) => /Failed \(Ledger\)/i.test(w))
    ) {
      const idx = errors.findIndex((e) =>
        /non finalisée \(pending\/failed\)/i.test(e)
      );
      if (idx >= 0) errors.splice(idx, 1);
    }

    const ledgerFailed = warnings.some((w) => /Failed \(Ledger\)/i.test(w));

    const status: ImportDraftRow["status"] =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok";

    const autoDeselect =
      errors.length > 0 ||
      type === "TRANSFERT_CASH" ||
      type === "TRANSFERT_TITRE" ||
      type == null ||
      ledgerSkipNoQty ||
      ledgerFailed ||
      (formatId === "revolut" &&
        type === "RETRAIT" &&
        !ticker &&
        /card|atm/i.test(typeRaw + descriptionRaw));

    const platformName = platformRaw?.trim() ? platformRaw.trim() : null;

    // Ledger : nom d’actif = ticker ; plateforme = Account Name (Solana, Arbitrum…)
    // Notes = hash + account pour dédup / audit
    const notesParts =
      formatId === "ledger_live"
        ? [
            notesRaw,
            platformName ? `account:${platformName}` : "",
            descriptionRaw,
            productRaw,
          ]
        : [notesRaw, descriptionRaw, productRaw];

    rows.push({
      line,
      selected: !autoDeselect,
      status,
      errors,
      warnings,
      type,
      occurredAt: date ? toIsoLocal(date) : null,
      ticker,
      name: name || ticker,
      quantity: qty != null ? String(qty) : null,
      unitPrice: unitPrice != null ? String(unitPrice) : null,
      fees: String(fees),
      currency,
      cashAmount: cashAmount != null ? String(Math.abs(cashAmount)) : null,
      notes: notesParts.filter(Boolean).join(" · ") || null,
      // Une seule plateforme d’import « Ledger Live » recommandée ;
      // Account Name reste en notes. Si l’utilisateur veut scinder par chaîne,
      // le champ platform du CSV peut être mappé manuellement.
      platformName:
        formatId === "ledger_live"
          ? platformName
            ? `Ledger · ${platformName}`
            : "Ledger Live"
          : platformName,
      assetClass,
      raw,
    });
  });

  return { rows, columnMap, formatLabel };
}
