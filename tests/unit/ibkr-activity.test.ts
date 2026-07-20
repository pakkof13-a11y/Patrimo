import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  expandIbkrActivityStatement,
  isIbkrActivityStatement,
} from "@/app/lib/import/ibkr-activity";
import { importCsv } from "@/app/lib/import/import-csv";
import { parseDate } from "@/app/lib/import/normalize";

const SAMPLE_FR = `Statement,Header,Nom champ,Valeur champ
Statement,Data,BrokerName,Interactive Brokers Ireland Limited
Statement,Data,Title,Relevé de compte
Transactions,Header,DataDiscriminator,Catégorie d'actifs,Devise,Compte,Symbole,Date/Heure,Quantité,Prix trans.,Cours de clôt.,Produit,Comm/Tarif,Base,P/L réalisé,P/L MTM,Code
Transactions,Data,Order,Actions,EUR,U20453710,OVH,"2025-10-21, 03:17:30",15,9.265,8.92,-138.975,-0.694875,139.669875,0,-5.175,O
Transactions,Data,Order,Actions,USD,U18285124,AAPL,"2025-04-08, 15:02:59",1,174,172.42,-174,-0.35,174.35,0,-1.58,O
Transactions,Data,Order,Actions,USD,U18285124,AAPL,"2025-06-27, 16:04:18",-1,201.02,201.08,201.02,-0.35,-174.35,26.32,-0.06,C
Transactions,SubTotal,,Actions,USD,AAPL,,,0,,,27.02,-0.70,0,26.32,-1.64,
Dividendes,Header,Devise,Compte,Date,Description,Montant
Dividendes,Data,USD,U18285124,2025-12-10,PYPL(US70450Y1038) Dividende en espèces USD 0.14 par action,0.7
Dividendes,Data,Total,,,,0.7
Dépôts et retraits,Header,Devise,Compte,Date de règlement,Description,Montant
Dépôts et retraits,Data,EUR,U18285124,2025-03-05,Transfert électronique de fonds,2000
Dépôts et retraits,Data,EUR,U18285124,2025-08-07,Déboursement initié,-1000
`;

const SAMPLE_EN = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers Ireland Limited
Statement,Data,Title,Activity Statement
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,ADBE,"2025-10-20, 09:30:04",0.5,334.65,343.4,-167.325,-0.35036825,167.67536825,0,4.375,O;RP
Trades,Data,Order,Stocks,USD,PYPL,"2025-07-31, 10:54:21",5,69.12,68.76,-345.6,-0.35139225,345.95139225,0,-1.8,O
Trades,SubTotal,,Stocks,USD,PYPL,,5,,,-345.6,-0.35,345.95,0,-1.8,
Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount
Deposits & Withdrawals,Data,EUR,2025-09-02,Electronic Fund Transfer,250
Deposits & Withdrawals,Data,EUR,2025-08-07,Disbursement Initiated by User,-1000
Deposits & Withdrawals,Data,Total,,,-750
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2025-12-10,PYPL(US70450Y1038) Cash Dividend USD 0.14 per Share (Ordinary Dividend),0.7
Dividends,Data,Total,,,0.7
`;

describe("IBKR Activity Statement", () => {
  it("detects FR and EN multi-section statements", () => {
    expect(isIbkrActivityStatement(SAMPLE_FR)).toBe(true);
    expect(isIbkrActivityStatement(SAMPLE_EN)).toBe(true);
    expect(isIbkrActivityStatement("date,symbol,qty\n2024-01-01,AAPL,1")).toBe(
      false
    );
  });

  it("expands FR Transactions + dividendes + dépôts", () => {
    const exp = expandIbkrActivityStatement(SAMPLE_FR);
    expect(exp.matched).toBe(true);
    expect(exp.tradeCount).toBe(3);
    expect(exp.dividendCount).toBe(1);
    expect(exp.depositCount).toBe(2);
    const buy = exp.csv.rows.find(
      (r) => r.Symbol === "AAPL" && r["Buy/Sell"] === "BUY"
    );
    const sell = exp.csv.rows.find(
      (r) => r.Symbol === "AAPL" && r["Buy/Sell"] === "SELL"
    );
    expect(buy?.Quantity).toBe("1");
    expect(sell?.Quantity).toBe("1");
    expect(buy?.["T. Price"]).toBe("174");
    const div = exp.csv.rows.find((r) => r["Buy/Sell"] === "DIVIDEND");
    expect(div?.Symbol).toBe("PYPL");
    expect(div?.Proceeds).toBe("0.7");
  });

  it("expands EN Trades + dividends + deposits", () => {
    const exp = expandIbkrActivityStatement(SAMPLE_EN);
    expect(exp.matched).toBe(true);
    expect(exp.tradeCount).toBe(2);
    expect(exp.dividendCount).toBe(1);
    expect(exp.depositCount).toBe(2);
    const adbe = exp.csv.rows.find((r) => r.Symbol === "ADBE");
    expect(adbe?.["Buy/Sell"]).toBe("BUY");
    expect(adbe?.Quantity).toBe("0.5");
  });

  it("importCsv produces ok drafts for FR sample", () => {
    const r = importCsv(SAMPLE_FR, { formatId: "interactive_brokers" });
    expect(r.formatId).toBe("interactive_brokers");
    expect(r.drafts.length).toBeGreaterThanOrEqual(6);
    const errors = r.drafts.filter((d) => d.status === "error");
    expect(errors).toEqual([]);
    const achats = r.drafts.filter((d) => d.type === "ACHAT");
    const ventes = r.drafts.filter((d) => d.type === "VENTE");
    expect(achats.length).toBe(2);
    expect(ventes.length).toBe(1);
    expect(r.drafts.some((d) => d.type === "DIVIDENDE")).toBe(true);
    expect(r.drafts.some((d) => d.type === "APPORT")).toBe(true);
    expect(r.drafts.some((d) => d.type === "RETRAIT")).toBe(true);
  });

  it("importCsv produces ok drafts for EN sample", () => {
    const r = importCsv(SAMPLE_EN, { formatId: "auto" });
    expect(r.formatId).toBe("interactive_brokers");
    const errors = r.drafts.filter((d) => d.status === "error");
    expect(errors).toEqual([]);
    expect(r.drafts.some((d) => d.ticker === "ADBE" && d.type === "ACHAT")).toBe(
      true
    );
  });

  it("parses IBKR datetime with comma", () => {
    const d = parseDate("2025-10-21, 03:17:30");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(21);
  });

  it("imports real download folder CSVs when present", () => {
    const dir = "C:/Users/Pak-M/Downloads/IBKR";
    const files = [
      "5-3-25 to 5-3-26.csv",
      "MULTI_20250717_20260717.csv",
    ];
    for (const name of files) {
      let text: string;
      try {
        text = readFileSync(join(dir, name), "utf8");
      } catch {
        return; // skip if user folder missing in CI
      }
      expect(isIbkrActivityStatement(text)).toBe(true);
      const r = importCsv(text, { formatId: "auto" });
      expect(r.formatId).toBe("interactive_brokers");
      expect(r.drafts.length).toBeGreaterThan(0);
      const err = r.drafts.filter((d) => d.status === "error");
      expect(
        err,
        `${name}: ${err.map((e) => e.errors.join(",")).join(" | ")}`
      ).toEqual([]);
      const trades = r.drafts.filter(
        (d) => d.type === "ACHAT" || d.type === "VENTE"
      );
      expect(trades.length).toBeGreaterThan(0);
    }
  });
});
