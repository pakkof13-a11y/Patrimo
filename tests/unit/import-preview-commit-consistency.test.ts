import { describe, expect, it } from "vitest";
import { importCsv } from "@/app/lib/import/import-csv";

/**
 * L'aperçu d'import (`transactions`, issu de `adapter.parse`) et ce qui est
 * réellement écrit (`drafts`, issu de `mapCsvToDrafts`) sont produits par deux
 * chemins distincts. Ils doivent au minimum s'accorder sur le **sens** de
 * l'opération : annoncer « Achat » pour une ligne qui sera importée en revenu
 * induit l'utilisateur en erreur au moment où il valide.
 */

const NEXO_HEADERS =
  "Transaction,Type,Input Currency,Input Amount,Output Currency,Output Amount,USD Equivalent,Details,Date / Time";

/**
 * Sens économique commun aux deux représentations.
 *
 * REWARD / AIRDROP comptent comme un **revenu** : ce sont des réceptions
 * gratuites (coût d'acquisition nul), pas des acquisitions payées. Le commit
 * bascule d'ailleurs volontairement un INTERET payé en crypto vers REWARD, qui
 * est la modélisation la plus précise du même événement.
 */
function direction(type: string | null): "in" | "out" | "income" | "other" {
  if (!type) return "other";
  const t = type.toUpperCase();
  if (
    ["DIVIDENDE", "COUPON", "INTERET", "LOYER", "DIVIDEND", "REWARD", "AIRDROP"].includes(t)
  ) {
    return "income";
  }
  if (["ACHAT", "BUY", "APPORT"].includes(t)) return "in";
  if (["VENTE", "SELL", "RETRAIT"].includes(t)) return "out";
  return "other";
}

describe("cohérence aperçu ↔ commit (Nexo)", () => {
  it("un intérêt est annoncé comme revenu, pas comme achat", () => {
    const csv = [
      NEXO_HEADERS,
      "NXT1,Interest,USDT,0.484,USDT,0.484,$0.48,USDT Interest Earned,2024-02-11 06:00:00",
    ].join("\n");

    const res = importCsv(csv, { formatId: "auto" });
    expect(res.formatId).toBe("nexo");

    const preview = res.transactions[0];
    const draft = res.drafts[0];
    expect(preview).toBeDefined();
    expect(draft).toBeDefined();

    // Avant correctif : l'aperçu annonçait "BUY" (→ "in") alors que le commit
    // classe la ligne en INTERET (→ "income").
    expect(direction(preview!.type)).toBe("income");
    expect(direction(draft!.type)).toBe("income");
    expect(direction(preview!.type)).toBe(direction(draft!.type));
  });

  it("un retrait reste sortant des deux côtés", () => {
    const csv = [
      NEXO_HEADERS,
      "NXT2,Withdrawal,USDT,2050.19,USDT,2050.19,$2050.87,Withdraw,2024-02-12 06:00:00",
    ].join("\n");

    const res = importCsv(csv, { formatId: "auto" });
    const preview = res.transactions[0];
    const draft = res.drafts[0];
    expect(direction(preview!.type)).toBe("out");
    expect(direction(draft!.type)).toBe("out");
  });
});

describe("réception crypto — l'avertissement énonce le coût nul", () => {
  it("signale explicitement la conséquence sur le prix de revient", () => {
    const csv = [
      NEXO_HEADERS,
      "NXT3,Deposit,BTC,0.5,BTC,0.5,$35000,Deposit,2024-03-10 10:00:00",
    ].join("\n");

    const res = importCsv(csv, { formatId: "auto" });
    const draft = res.drafts[0]!;

    // Une réception est importée avec un coût d'acquisition nul : correct pour
    // un staking, faux pour un transfert d'actifs déjà détenus. L'utilisateur
    // doit lire la conséquence, pas seulement l'étiquette « reward ».
    expect(draft.type).toBe("REWARD");
    const joined = draft.warnings.join(" ");
    expect(joined).toContain("coût d'acquisition 0");
    expect(joined).toContain("transfert");
    expect(draft.status).toBe("warning");
  });
});
