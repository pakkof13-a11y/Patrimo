import { describe, it, expect } from "vitest";
import { importCsv } from "@/app/lib/import/import-csv";

describe("Hyperliquid Trade History — end-to-end drafts", () => {
  const headers = "time,coin,dir,px,sz,ntl,fee,closedPnl";

  it("auto-detects and produces an ACHAT draft for a Buy", () => {
    const csv = `${headers}
25/09/2025 13:33:06,HYPE/USDC,Buy,42.184,20,843.68,0.01344,-0.56695296
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("hyperliquid_trade");
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]?.type).toBe("ACHAT");
    expect(r.drafts[0]?.ticker).toBe("HYPE");
    expect(r.drafts[0]?.status).toBe("ok");
  });

  it("skips Open/Close Short rows (unsupported derivatives)", () => {
    const csv = `${headers}
20/05/2025 10:36:08,PAXG,Open Short,3245.7,0.172,558.2603999999999,0.080389,-0.080389
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("hyperliquid_trade");
    expect(r.drafts).toHaveLength(0);
  });
});

describe("Hyperliquid Funding History — end-to-end drafts", () => {
  const headers = "time,coin,sz,side,payment,rate";

  it("auto-detects and produces an INTERET draft for positive payment", () => {
    const csv = `${headers}
20/05/2025 02:00:00,PAXG,1.05,Short,1.293073,0.0000250038
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("hyperliquid_funding");
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]?.type).toBe("INTERET");
    expect(r.drafts[0]?.ticker).toBe("PAXG");
    expect(r.drafts[0]?.cashAmount).toBe("1.293073");
  });

  it("produces a FRAIS draft for negative payment", () => {
    const csv = `${headers}
29/05/2025 02:00:00,PAXG,1.05,Short,-0.098165,-0.0000012551
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("hyperliquid_funding");
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]?.type).toBe("FRAIS");
    expect(r.drafts[0]?.cashAmount).toBe("0.098165");
  });
});
