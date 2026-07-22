/**
 * Parseur Interactive Brokers — Activity Statement (CSV multi-sections).
 *
 * Format IBKR (FR ou EN) :
 *   Section,Header|Data|SubTotal|Total,col1,col2,...
 * Sections utiles : Trades / Transactions, Dividends / Dividendes,
 * Deposits & Withdrawals / Dépôts et retraits.
 *
 * Le preset « interactive_brokers » historique attendait un CSV plat
 * (TradeDate, Symbol, Buy/Sell…) — les exports Activity Statement
 * officiels ne passent pas par ce chemin sans pré-expansion.
 */

import { parseLine, normalizeHeader, type ParsedCsv } from "./csv-parse";
import { parseIbkrEasternDateTime } from "./normalize";

export type IbkrActivityExpandResult = {
  /** true si le fichier est un Activity Statement IBKR */
  matched: boolean;
  /** CSV plat compatible mapCsvToDrafts (format interactive_brokers) */
  csv: ParsedCsv;
  tradeCount: number;
  dividendCount: number;
  depositCount: number;
  warnings: string[];
  /** Comptes IBKR distincts détectés dans le relevé (ex. U18285124) */
  accounts: string[];
};

export type IbkrActivityExpandOptions = {
  /** Si fourni, ne conserve que les lignes des comptes listés */
  accountIds?: string[];
};

const FLAT_HEADERS = [
  "TradeDate",
  "Symbol",
  "Buy/Sell",
  "OperationType",
  "Quantity",
  "T. Price",
  "IBCommission",
  "CurrencyPrimary",
  "Proceeds",
  "Description",
  "AssetClass",
  "Notes",
] as const;

function norm(s: string): string {
  return normalizeHeader(s);
}

/** Détecte un Activity Statement IBKR (multi-sections). */
export function isIbkrActivityStatement(text: string): boolean {
  const head = text.slice(0, 2500);
  if (!/Interactive Brokers/i.test(head) && !/\bBrokerName\b/i.test(head)) {
    // FR : BrokerName dans les premières lignes
    if (!/BrokerName/i.test(head)) return false;
  }
  // Structure section,Header|Data
  if (!/^(Statement|Informations|Account|Trades|Transactions),/im.test(text)) {
    // Lignes du type "Trades,Header," ou "Transactions,Header,"
    if (!/,Header,/i.test(text) || !/,Data,/i.test(text)) return false;
  }
  // Au moins une section trades
  if (
    !/^Trades,Header,/im.test(text) &&
    !/^Transactions,Header,/im.test(text)
  ) {
    // Encore OK si dividendes/dépôts seuls, mais rare
    if (
      !/^Dividends,Header,/im.test(text) &&
      !/^Dividendes,Header,/im.test(text)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Parse une ligne CSV IBKR en cellules (virgule + quotes).
 */
function cellsOf(line: string): string[] {
  return parseLine(line, ",").map((c) => c.replace(/^\uFEFF/, "").trim());
}

function findCol(
  headers: string[],
  ...candidates: string[]
): number {
  const n = headers.map((h) => norm(h));
  for (const c of candidates) {
    const cn = norm(c);
    const i = n.findIndex((h) => h === cn || h.includes(cn) || cn.includes(h));
    if (i >= 0) return i;
  }
  return -1;
}

function absQty(q: number): number {
  return Math.abs(q);
}

function sideFromQty(q: number): "BUY" | "SELL" {
  return q < 0 ? "SELL" : "BUY";
}

/**
 * Extrait les trades Order + dividendes + dépôts → CSV plat.
 */
export function expandIbkrActivityStatement(
  text: string,
  options: IbkrActivityExpandOptions = {}
): IbkrActivityExpandResult {
  const warnings: string[] = [];
  if (!isIbkrActivityStatement(text)) {
    return {
      matched: false,
      csv: { headers: [], rows: [], delimiter: ",", rawLineCount: 0 },
      tradeCount: 0,
      dividendCount: 0,
      depositCount: 0,
      warnings: [],
      accounts: [],
    };
  }
  const accountFilter = options.accountIds?.length
    ? new Set(options.accountIds)
    : null;

  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);

  type SectionKind =
    | "trades"
    | "dividends"
    | "deposits"
    | "account_info"
    | "other";
  let section: SectionKind = "other";
  let sectionHeaders: string[] = [];
  const flatRows: Record<string, string>[] = [];
  let tradeCount = 0;
  let dividendCount = 0;
  let depositCount = 0;
  let currentAccount = "";
  const accountsSeen: string[] = [];

  function classifySection(name: string): SectionKind {
    const n = norm(name);
    if (n === "account_information" || n === "informations_du_compte") {
      return "account_info";
    }
    if (
      n === "trades" ||
      n === "transactions" ||
      n.includes("transaction") ||
      n === "trades"
    ) {
      return "trades";
    }
    if (n === "dividends" || n === "dividendes" || n.startsWith("dividend")) {
      return "dividends";
    }
    if (
      n.includes("deposit") ||
      n.includes("retrait") ||
      n.includes("withdraw") ||
      n.includes("depots")
    ) {
      return "deposits";
    }
    return "other";
  }

  for (const line of lines) {
    const cells = cellsOf(line);
    if (cells.length < 2) continue;
    const sectionName = cells[0] || "";
    const rowType = (cells[1] || "").trim();

    if (/^header$/i.test(rowType)) {
      section = classifySection(sectionName);
      // Headers = colonnes après Section,Header
      sectionHeaders = cells.slice(2);
      continue;
    }

    if (!/^data$/i.test(rowType)) {
      // SubTotal / Total / Notes → ignorer
      continue;
    }

    // Chaque relevé multi-comptes répète les sections par bloc "Account
    // Information" — on suit le compte courant pour taguer les lignes.
    if (section === "account_info") {
      const fieldName = (cells[2] || "").trim();
      if (/^account$/i.test(fieldName) || /^compte$/i.test(fieldName)) {
        currentAccount = (cells[3] || "").trim();
        if (currentAccount && !accountsSeen.includes(currentAccount)) {
          accountsSeen.push(currentAccount);
        }
      }
      continue;
    }

    if (accountFilter && currentAccount && !accountFilter.has(currentAccount)) {
      // Compte exclu par l'utilisateur (sélecteur multi-comptes)
      continue;
    }

    if (section === "trades") {
      const discIdx = findCol(
        sectionHeaders,
        "DataDiscriminator",
        "Data Discriminator"
      );
      // Après Header, les données Data ont : section, Data, [DataDiscriminator], ...
      // cells[0]=section, cells[1]=Data, cells[2]=Order|… aligné sur sectionHeaders[0]
      const dataCells = cells.slice(2);
      const disc =
        discIdx >= 0
          ? dataCells[discIdx] || ""
          : dataCells[0] || "";
      // FR/EN : Order (pas Trade/ClosedLot/… qui doublonnent)
      if (!/^order$/i.test(disc.trim()) && !/^ordre$/i.test(disc.trim())) {
        continue;
      }

      const get = (...names: string[]) => {
        const i = findCol(sectionHeaders, ...names);
        return i >= 0 ? dataCells[i] || "" : "";
      };

      const symbol = get("Symbol", "Symbole");
      const dateRaw = get("Date/Time", "Date/Heure", "DateTime", "Date");
      const qtyRaw = get("Quantity", "Quantité", "Quantite");
      const priceRaw = get(
        "T. Price",
        "T Price",
        "T.Price",
        "Prix trans.",
        "Prix trans",
        "Price",
        "Prix"
      );
      const feeRaw = get(
        "Comm/Fee",
        "Comm/Tarif",
        "Commission",
        "IBCommission",
        "Comm Fee"
      );
      const currency = get("Currency", "Devise", "CurrencyPrimary");
      const proceeds = get("Proceeds", "Produit");
      const assetCat = get(
        "Asset Category",
        "Catégorie d'actifs",
        "Categorie d actifs",
        "AssetCategory"
      );
      const account = get("Account", "Compte");

      if (!symbol || !dateRaw || !qtyRaw) continue;

      // Quantity signée IBKR : >0 buy, <0 sell
      const qtyNum = Number(String(qtyRaw).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(qtyNum) || qtyNum === 0) continue;

      const side = sideFromQty(qtyNum);
      const qtyAbs = String(absQty(qtyNum));
      // Fees souvent négatifs dans IBKR
      const feeAbs = (() => {
        const n = Number(String(feeRaw).replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n)) return feeRaw || "0";
        return String(Math.abs(n));
      })();

      // "Trade execution times are displayed in Eastern Time" (note IBKR)
      // → convertir explicitement en UTC (DST-aware) avant stockage.
      const tradeUtc = parseIbkrEasternDateTime(dateRaw);
      const dateForStorage = tradeUtc ? tradeUtc.toISOString() : dateRaw;

      flatRows.push({
        TradeDate: dateForStorage,
        Symbol: symbol,
        "Buy/Sell": side,
        OperationType: side === "BUY" ? "ACHAT" : "VENTE",
        Quantity: qtyAbs,
        "T. Price": priceRaw,
        IBCommission: feeAbs,
        CurrencyPrimary: currency || "EUR",
        Proceeds: proceeds,
        Description: symbol,
        AssetClass: assetCat || "ACTIONS",
        Notes: [account || currentAccount, disc].filter(Boolean).join(" · "),
      });
      tradeCount++;
      continue;
    }

    if (section === "dividends") {
      const dataCells = cells.slice(2);
      // Skip totals
      if (
        dataCells.some((c) =>
          /^(total|total en|total in|total dividends)/i.test(c.trim())
        )
      ) {
        continue;
      }
      const get = (...names: string[]) => {
        const i = findCol(sectionHeaders, ...names);
        return i >= 0 ? dataCells[i] || "" : "";
      };
      const currency = get("Currency", "Devise");
      const dateRaw = get("Date", "Date de règlement", "Date de reglement");
      const desc = get("Description");
      const amount = get("Amount", "Montant");
      if (!dateRaw || !amount) continue;
      const amtNum = Number(String(amount).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(amtNum) || amtNum === 0) continue;
      // Ticker depuis DESCRIPTION : PYPL(US…) ou AAPL(…)
      const tickMatch = desc.match(/^([A-Z0-9.]+)\s*\(/i);
      const ticker = tickMatch?.[1] || null;

      flatRows.push({
        TradeDate: dateRaw,
        Symbol: ticker || "DIV",
        "Buy/Sell": "DIVIDEND",
        OperationType: "DIVIDENDE",
        Quantity: "",
        "T. Price": "",
        IBCommission: "0",
        CurrencyPrimary: currency || "EUR",
        Proceeds: String(Math.abs(amtNum)),
        Description: desc || "Dividende",
        AssetClass: "ACTIONS",
        Notes: [currentAccount, "IBKR dividend"].filter(Boolean).join(" · "),
      });
      dividendCount++;
      continue;
    }

    if (section === "deposits") {
      const dataCells = cells.slice(2);
      if (
        dataCells.some((c) => /^total/i.test(c.trim()))
      ) {
        continue;
      }
      const get = (...names: string[]) => {
        const i = findCol(sectionHeaders, ...names);
        return i >= 0 ? dataCells[i] || "" : "";
      };
      const currency = get("Currency", "Devise");
      const dateRaw = get(
        "Settle Date",
        "Date de règlement",
        "Date de reglement",
        "Date"
      );
      const desc = get("Description");
      const amount = get("Amount", "Montant");
      if (!dateRaw || !amount) continue;
      const amtNum = Number(String(amount).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(amtNum) || amtNum === 0) continue;
      const isIn = amtNum > 0;

      flatRows.push({
        TradeDate: dateRaw,
        Symbol: currency || "EUR",
        "Buy/Sell": isIn ? "DEPOSIT" : "WITHDRAWAL",
        OperationType: isIn ? "APPORT" : "RETRAIT",
        Quantity: "",
        "T. Price": "",
        IBCommission: "0",
        CurrencyPrimary: currency || "EUR",
        Proceeds: String(Math.abs(amtNum)),
        Description: desc || (isIn ? "Dépôt" : "Retrait"),
        AssetClass: "CASH",
        Notes: [currentAccount, "IBKR cash"].filter(Boolean).join(" · "),
      });
      depositCount++;
    }
  }

  if (tradeCount === 0 && dividendCount === 0 && depositCount === 0) {
    warnings.push(
      "Activity Statement IBKR détecté mais aucune ligne Trades/Dividendes/Dépôts exploitable"
    );
  } else {
    warnings.push(
      `IBKR Activity Statement : ${tradeCount} trade(s), ${dividendCount} dividende(s), ${depositCount} dépôt/retrait(s)`
    );
  }

  return {
    matched: true,
    accounts: accountsSeen,
    csv: {
      headers: [...FLAT_HEADERS],
      rows: flatRows,
      delimiter: ",",
      rawLineCount: lines.length,
    },
    tradeCount,
    dividendCount,
    depositCount,
    warnings,
  };
}
