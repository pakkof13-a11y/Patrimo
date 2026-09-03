import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts, type ImportDraftRow } from "@/app/lib/import/map-rows";
import { detectFormatFromHeaders } from "@/app/lib/import/presets";
import { platformHintForFormat } from "@/app/lib/import/format-platform";

/**
 * Exports réels Crypto.com, eToro et Interactive Brokers.
 *
 * Les assertions portent sur des montants et des sens d'opération : un test qui
 * se bornerait au nombre de lignes laisserait passer une conversion crypto lue
 * comme un achat, une retenue à la source comptée en revenu, ou une opération
 * de change devenue position fantôme.
 */

function lire(fixture: string, formatId: string): ImportDraftRow[] {
  const csv = parseCsv(
    readFileSync(`tests/fixtures/import/${fixture}.csv`, "utf8")
  );
  return mapCsvToDrafts(csv, formatId as never).rows;
}

function entetes(fixture: string): string[] {
  return parseCsv(readFileSync(`tests/fixtures/import/${fixture}.csv`, "utf8"))
    .headers;
}

/** Toutes les lignes dont une cellule d'origine contient ce fragment. */
function toutes(rows: ImportDraftRow[], fragment: string): ImportDraftRow[] {
  const hits = rows.filter((r) =>
    Object.values(r.raw).some((v) => v.includes(fragment))
  );
  expect(hits.length, `« ${fragment} » introuvable`).toBeGreaterThan(0);
  return hits;
}

describe("détection de format", () => {
  it("chaque export est reconnu sans ambiguïté", () => {
    expect(detectFormatFromHeaders(entetes("cryptocom-export"))).toBe("cryptocom");
    expect(detectFormatFromHeaders(entetes("etoro-export"))).toBe("etoro");
    expect(detectFormatFromHeaders(entetes("ibkr-trades-export"))).toBe(
      "interactive_brokers"
    );
    // Le relevé de dividendes n'a aucune colonne de commission : sans règle
    // dédiée il se faisait passer pour un relevé Boursorama, sur le seul ISIN.
    expect(detectFormatFromHeaders(entetes("ibkr-dividends-export"))).toBe(
      "interactive_brokers"
    );
  });

  it("la détection ne capture pas les exports voisins", () => {
    for (const [fixture, interdit] of [
      ["coinbase-export", "etoro"],
      ["degiro-export", "etoro"],
      ["directa-export", "interactive_brokers"],
      ["bitvavo-export", "cryptocom"],
    ] as const) {
      expect(detectFormatFromHeaders(entetes(fixture)), fixture).not.toBe(
        interdit
      );
    }
  });

  it("chaque format vise sa plateforme du catalogue", () => {
    expect(platformHintForFormat("etoro")?.logoKey).toBe("ETORO");
    expect(platformHintForFormat("cryptocom")?.logoKey).toBe("CRYPTO_COM");
    expect(platformHintForFormat("interactive_brokers")?.logoKey).toBe(
      "INTERACTIVE_BROKERS"
    );
  });
});

describe("Crypto.com", () => {
  const rows = lire("cryptocom-export", "cryptocom");

  it("une conversion crypto donne deux jambes, pas une opération bâtarde", () => {
    /*
      « EGLD -> USDC » : 4,15 EGLD cédés contre 150,865358 USDC, le tout valant
      143,33 €. Lue en une seule opération, la ligne attribuait la quantité de
      l'actif cédé à l'actif reçu.
    */
    const jambes = toutes(rows, "EGLD -> USDC");
    expect(jambes).toHaveLength(2);

    const vente = jambes.find((r) => r.type === "VENTE")!;
    const achat = jambes.find((r) => r.type === "ACHAT")!;
    expect(vente.ticker).toBe("EGLD");
    expect(Number(vente.quantity)).toBeCloseTo(4.15, 8);
    expect(achat.ticker).toBe("USDC");
    expect(Number(achat.quantity)).toBeCloseTo(150.865358, 8);

    // Même contre-valeur des deux côtés : la conversion ne crée pas de cash.
    expect(Number(vente.cashAmount)).toBeCloseTo(143.33016114, 6);
    expect(Number(achat.cashAmount)).toBeCloseTo(143.33016114, 6);
  });

  it("le cours de chaque jambe est celui de son propre actif", () => {
    const jambes = toutes(rows, "XRP -> BTC");
    const vente = jambes.find((r) => r.type === "VENTE")!;
    const achat = jambes.find((r) => r.type === "ACHAT")!;
    // 1 173,17 € / 500 XRP et 1 173,17 € / 0,01152324 BTC
    expect(Number(vente.unitPrice)).toBeCloseTo(2.3463378, 5);
    expect(Number(achat.unitPrice)).toBeCloseTo(101808.946, 2);
  });

  it("le signe du montant décide du sens, pas le libellé", () => {
    /*
      Les deux « Balance Conversion » ne diffèrent que par le signe d'`Amount`.
      Toutes deux typées ACHAT, le portefeuille gagnait 81 USDT au lieu de les
      céder.
    */
    const conversions = toutes(rows, "Balance Conversion");
    expect(conversions).toHaveLength(2);
    const credit = conversions.find((r) => r.ticker === "USDC")!;
    const debit = conversions.find((r) => r.ticker === "USDT")!;
    expect(credit.type).toBe("ACHAT");
    expect(debit.type).toBe("VENTE");
    expect(Number(debit.quantity)).toBeCloseTo(81.161849, 8);
  });

  it("une recharge de carte est une cession de crypto", () => {
    const topUp = toutes(rows, "card_top_up")[0]!;
    expect(topUp.type).toBe("VENTE");
    expect(topUp.ticker).toBe("USDT");
    expect(Number(topUp.quantity)).toBeCloseTo(235.08, 6);
    expect(Number(topUp.cashAmount)).toBeCloseTo(210, 6);
  });

  it("stakings et cashbacks restent des REWARD", () => {
    for (const r of toutes(rows, "Cardholder CRO Stake Reward")) {
      expect(r.type).toBe("REWARD");
      expect(r.ticker).toBe("CRO");
    }
    for (const r of toutes(rows, "Card Cashback")) expect(r.type).toBe("REWARD");
    for (const r of toutes(rows, "CRO Lockup Rewards")) {
      expect(r.type).toBe("REWARD");
    }
  });

  it("les transferts entre poches ne sont pas des opérations de marché", () => {
    for (const r of toutes(rows, "Transfer: App wallet -> Exchange")) {
      expect(r.type).toMatch(/^TRANSFERT_/);
    }
    for (const r of toutes(rows, "Transfer: Exchange -> App wallet")) {
      expect(r.type).toMatch(/^TRANSFERT_/);
    }
  });

  it("la contre-valeur en devise du compte n'est jamais inventée", () => {
    // `Native Amount` porte le montant ; aucune ligne typée ne doit s'en
    // passer en le remplaçant par zéro.
    for (const r of rows) {
      if (r.cashAmount != null) expect(Number(r.cashAmount)).not.toBeNaN();
    }
    expect(new Set(rows.map((r) => r.currency))).toEqual(new Set(["EUR"]));
  });
});

describe("eToro", () => {
  const rows = lire("etoro-export", "etoro");

  it("lit toutes les lignes du relevé d'activité", () => {
    expect(rows).toHaveLength(28);
  });

  it("l'ouverture et la clôture de position sont un achat et une vente", () => {
    const ouverture = rows.find(
      (r) => r.raw["Position ID"] === "2596572937"
    )!;
    expect(ouverture.type).toBe("ACHAT");
    expect(ouverture.ticker).toBe("AMD");
    expect(Number(ouverture.quantity)).toBeCloseTo(0.337209, 6);
    expect(Number(ouverture.cashAmount)).toBeCloseTo(49.88, 6);

    const cloture = rows.find((r) => r.raw["Position ID"] === "2602058508")!;
    expect(cloture.type).toBe("VENTE");
    expect(cloture.ticker).toBe("AMD");
    expect(Number(cloture.cashAmount)).toBeCloseTo(61.27, 6);
  });

  it("l'actif est extrait de Details, sa devise de cotation ne l'est pas", () => {
    // « KER/EUR » désigne Kering ; « EUR » est la devise de l'instrument, pas
    // celle du compte — la confondre aurait faussé tout compte en dollars.
    const kering = toutes(rows, "KER/EUR");
    for (const r of kering) {
      expect(r.type).toBe("DIVIDENDE");
      expect(r.ticker).toBe("KER");
    }
  });

  it("la devise absente de l'export est signalée, pas devinée en silence", () => {
    for (const r of rows) {
      expect(r.warnings.join(" ")).toMatch(/Devise du compte absente/);
    }
  });

  it("les frais eToro sont reconnus sous tous leurs noms", () => {
    for (const libelle of [
      "Withdraw Fee",
      "Withdrawal Conversion Fee",
      "Overnight fee",
      "SDRT",
    ]) {
      for (const r of toutes(rows, libelle)) {
        expect(r.type, libelle).toBe("FRAIS");
      }
    }
    for (const r of toutes(rows, "Withdraw Request")) {
      expect(r.type).toBe("RETRAIT");
    }
    for (const r of toutes(rows, "Interest Payment")) {
      expect(r.type).toBe("INTERET");
    }
  });

  it("un remboursement de frais n'est pas un versement au portefeuille", () => {
    // Typé APPORT, il aurait diminué d'autant la performance mesurée.
    const refund = toutes(rows, "Overnight refund")[0]!;
    expect(refund.type).toBeNull();
    expect(refund.warnings.join(" ")).toMatch(/non représentable/);
  });

  it("les soldes courants ne deviennent pas des transactions", () => {
    /*
      `Realized Equity`, `Balance` et `NWA` sont recalculés à chaque ligne.
      Une ligne du CSV reste une ligne du brouillon : aucune n'est dédoublée
      par un état de compte.
    */
    const csv = parseCsv(
      readFileSync("tests/fixtures/import/etoro-export.csv", "utf8")
    );
    expect(rows).toHaveLength(csv.rows.length);
    for (const r of rows) {
      expect(Number(r.cashAmount ?? 0)).not.toBe(4581.91);
    }
  });

  it("les lignes de trésorerie ne portent pas de faux actif", () => {
    // « - » et « Daily » remplissent la colonne Details des frais : les laisser
    // passer aurait créé un titre nommé « Daily ».
    for (const r of rows) {
      expect(r.name).not.toBe("Daily");
      expect(r.name).not.toBe("-");
    }
  });
});

describe("Interactive Brokers — Flex Query trades", () => {
  const rows = lire("ibkr-trades-export", "interactive_brokers");

  it("lit toutes les lignes du relevé", () => {
    expect(rows).toHaveLength(11);
  });

  it("date, actif, quantité, cours, montant et commission sont récupérés", () => {
    const achat = rows.find(
      (r) => r.raw["ISIN"] === "CH0111762537" && r.type === "ACHAT"
    )!;
    // « 20230522 » : format compact des Flex Queries, lu comme une date et non
    // comme un numéro de série Excel.
    expect(achat.occurredAt?.slice(0, 10)).toBe("2023-05-22");
    expect(achat.ticker).toBe("CH0111762537");
    expect(Number(achat.quantity)).toBe(7);
    expect(Number(achat.unitPrice)).toBeCloseTo(282.7, 6);
    expect(Number(achat.cashAmount)).toBeCloseTo(1978.9, 6);
    expect(achat.currency).toBe("CHF");
    // La commission est écrite en débit négatif ; un frais reste un coût.
    expect(Number(achat.fees)).toBeCloseTo(5, 6);
  });

  it("chaque opération garde sa propre devise", () => {
    const devises = new Set(rows.map((r) => r.currency));
    expect(devises).toContain("CHF");
    expect(devises).toContain("USD");
  });

  it("une conversion de devise ne devient pas une vente de titre", () => {
    /*
      « SELL −8000 @ 1,1173 USD » sans ISIN, c'est 8 000 USD changés en CHF.
      Typée VENTE, la ligne aurait créé une position fantôme et double-compté
      le cash du compte.
    */
    const changes = rows.filter((r) => r.raw["ISIN"] === "");
    expect(changes).toHaveLength(3);
    for (const r of changes) {
      expect(r.type).toBeNull();
      expect(r.warnings.join(" ")).toMatch(/change IBKR/);
    }
  });

  it("aucune ligne de titre n'est perdue", () => {
    expect(rows.filter((r) => r.type === "ACHAT")).toHaveLength(8);
    expect(rows.filter((r) => r.type === "VENTE")).toHaveLength(0);
  });
});

describe("Interactive Brokers — Flex Query dividendes", () => {
  const rows = lire("ibkr-dividends-export", "interactive_brokers");

  it("un dividende porte son montant, sa devise et sa date de règlement", () => {
    const div = rows.find(
      (r) =>
        r.type === "DIVIDENDE" &&
        r.raw["Description"]?.includes("USD 0.6504 PER SHARE (Ordinary")
    )!;
    expect(div.occurredAt?.slice(0, 10)).toBe("2023-06-23");
    expect(div.ticker).toBe("US9220427424");
    expect(Number(div.cashAmount)).toBeCloseTo(137.23, 6);
    expect(div.currency).toBe("USD");
  });

  it("la retenue à la source est un frais, jamais un apport", () => {
    /*
      Montants toujours négatifs (−14,68 CHF, −20,58 USD…). Typées APPORT,
      ces lignes ajoutaient au patrimoine exactement ce qu'elles en retirent.
    */
    const taxes = rows.filter((r) => r.raw["Type"] === "Withholding Tax");
    expect(taxes).toHaveLength(4);
    for (const t of taxes) expect(t.type).toBe("FRAIS");
    const chf = taxes.find((t) => t.currency === "CHF")!;
    expect(Number(chf.cashAmount)).toBeCloseTo(14.68, 6);
  });

  it("un paiement compensatoire de dividende reste un revenu", () => {
    const lieu = rows.filter(
      (r) => r.raw["Type"] === "Payment In Lieu Of Dividends"
    );
    expect(lieu).toHaveLength(2);
    for (const r of lieu) expect(r.type).toBe("DIVIDENDE");
    const jpy = lieu.find((r) => r.currency === "JPY")!;
    expect(Number(jpy.cashAmount)).toBeCloseTo(455, 6);
  });

  it("dividendes et retenues ne sont pas fusionnés — aucun double comptage", () => {
    // Le relevé décrit la même distribution sur deux lignes (brut, puis impôt).
    // Elles restent deux mouvements distincts et de sens opposés.
    const vt0623 = rows.filter((r) =>
      r.raw["Description"]?.includes("USD 0.6504 PER SHARE")
    );
    expect(vt0623).toHaveLength(2);
    expect(new Set(vt0623.map((r) => r.type))).toEqual(
      new Set(["DIVIDENDE", "FRAIS"])
    );
  });
});

describe("eToro — devise du compte", () => {
  /*
    Les relevés récents inscrivent la devise dans l'intitulé de colonne
    (« Amount in (USD) ») plutôt que dans une colonne dédiée. C'est la seule
    source valable du fichier : `Details` porte la devise de cotation de
    l'instrument, pas celle du cash.
  */
  const releve = (enTeteMontant: string, enTeteSolde: string) =>
    [
      `Date,Type,Details,${enTeteMontant},Units,Realized Equity Change,Realized Equity,${enTeteSolde},Position ID,Asset type,NWA`,
      `02/01/2024 00:10:33,Dividend,NKE/USD,0.17,-,0.17,"4,581.91",99.60,2272508626,Stocks,0.00`,
      `17/01/2024 00:04:27,Dividend,KER/EUR,0.03,-,0.03,"4,581.91",0.80,697085768,Stocks,0.00`,
    ].join("\n");

  const drafts = (enTeteMontant: string, enTeteSolde = "Balance") =>
    mapCsvToDrafts(parseCsv(releve(enTeteMontant, enTeteSolde)), "etoro" as never)
      .rows;

  it("« Amount in (USD) » donne USD", () => {
    const rows = drafts("Amount in (USD)", "Balance in (USD)");
    for (const r of rows) expect(r.currency).toBe("USD");
  });

  it("« Amount in (EUR) » donne EUR", () => {
    const rows = drafts("Amount in (EUR)", "Balance in (EUR)");
    for (const r of rows) expect(r.currency).toBe("EUR");
  });

  it("l'en-tête devisé rend la colonne des montants exploitable", () => {
    /*
      `normalizeHeader` transforme « Amount in (USD) » en `amount_in_usd`, qui
      ne correspondait à aucun alias : la colonne n'était pas reconnue et le
      relevé remontait sans un seul montant.
    */
    const rows = drafts("Amount in (USD)", "Balance in (USD)");
    expect(Number(rows[0]!.cashAmount)).toBeCloseTo(0.17, 6);
    expect(Number(rows[1]!.cashAmount)).toBeCloseTo(0.03, 6);
  });

  it("la devise peut venir du seul en-tête de solde", () => {
    // Même compte, donc même devise : un `Balance in (GBP)` suffit.
    for (const r of drafts("Amount", "Balance in (GBP)")) {
      expect(r.currency).toBe("GBP");
    }
  });

  it("sans indication, la devise reste inconnue et l'avertissement subsiste", () => {
    const rows = drafts("Amount", "Balance");
    for (const r of rows) {
      expect(r.warnings.join(" ")).toMatch(/Devise du compte absente/);
    }
  });

  it("l'avertissement disparaît dès que la devise est connue", () => {
    for (const r of drafts("Amount in (USD)", "Balance in (USD)")) {
      expect(r.warnings.join(" ")).not.toMatch(/Devise du compte absente/);
    }
  });

  it("« KER/EUR » ne détermine jamais la devise du cash", () => {
    /*
      Le relevé porte un solde unique qui traverse indifféremment des lignes
      NKE/USD et KER/EUR : un même solde ne peut pas être à la fois en euros et
      en dollars. La ligne Kering d'un compte en dollars reste en dollars.
    */
    const rows = drafts("Amount in (USD)", "Balance in (USD)");
    const kering = rows.find((r) => r.ticker === "KER")!;
    expect(kering.currency).toBe("USD");

    // Et réciproquement : la ligne Nike d'un compte en euros reste en euros.
    const enEuros = drafts("Amount in (EUR)", "Balance in (EUR)");
    expect(enEuros.find((r) => r.ticker === "NKE")!.currency).toBe("EUR");
  });

  it("aucun repli arbitraire n'est introduit par la détection", () => {
    // Le fichier d'exemple n'a pas d'en-tête devisé : il doit continuer à
    // signaler l'inconnue plutôt qu'à se voir attribuer une devise.
    const reel = lire("etoro-export", "etoro");
    for (const r of reel) {
      expect(r.warnings.join(" ")).toMatch(/Devise du compte absente/);
    }
  });

  it("la détection de format survit aux en-têtes devisés", () => {
    const csv = parseCsv(releve("Amount in (USD)", "Balance in (USD)"));
    expect(detectFormatFromHeaders(csv.headers)).toBe("etoro");
  });
});
