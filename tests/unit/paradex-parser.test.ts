import { describe, it, expect } from "vitest";
import { parseParadexMarket } from "@/app/lib/import/adapters/paradex-adapter";
import { importCsv } from "@/app/lib/import/import-csv";

const HEADERS =
  "id,side,liquidity,market,order_id,price,size,fee,fee_currency,created_at,remaining_size,client_id,fill_type,realized_pnl,realized_funding,account,underlying_price,flags,orderbook_seq_no,rawId";

describe("Paradex market field parsing", () => {
  it("parses a perpetual market", () => {
    expect(parseParadexMarket("PAXG-USD-PERP")).toEqual({
      asset: "PAXG",
      kind: "PERP",
    });
    expect(parseParadexMarket("BTC-USD-PERP")).toEqual({
      asset: "BTC",
      kind: "PERP",
    });
  });

  it("parses a call and put option with strike", () => {
    expect(parseParadexMarket("BTC-USD-118000-C")).toEqual({
      asset: "BTC",
      kind: "OPTION_CALL",
      strike: 118000,
    });
    expect(parseParadexMarket("BTC-USD-125000-P")).toEqual({
      asset: "BTC",
      kind: "OPTION_PUT",
      strike: 125000,
    });
  });

  it("parses a spot market", () => {
    expect(parseParadexMarket("DIME-USD")).toEqual({
      asset: "DIME",
      kind: "SPOT",
    });
  });
});

describe("Paradex Fills import", () => {
  it("auto-detects the Paradex format and produces a BUY draft for a PERP fill", () => {
    const csv = `${HEADERS}
FILL-1783804380160201709230310003,BUY,MAKER,PAXG-USD-PERP,1783797946240201709238890000,"4104.58","1.007","0",USDC,2026-07-11T21:13:00.167Z,0,pdx-ui-rJoXAxhLrAeKoSfIkWQIy,FILL,"-341.9392599016956641","221.6925990116643946",0x1172e493de7bfca0ac8488ad3d73949ad46b2e315f2f0892b73896fde618b43,"4103.7131087",["interactive","fastfill"],717957218,1783804380160201709230310003
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("paradex");
    expect(r.drafts).toHaveLength(1);
    const draft = r.drafts[0]!;
    expect(draft.status).toBe("ok");
    expect(draft.type).toBe("ACHAT");
    expect(draft.ticker).toBe("PAXG");
    expect(draft.quantity).toBe("1.007");
    expect(draft.unitPrice).toBe("4104.58");
  });

  it("produces a SELL draft for a spot fill and ignores non-FILL rows", () => {
    const csv = `${HEADERS}
FILL-1773677055980201709239930001,SELL,MAKER,DIME-USD,1773676887450201709230660000,"0.03848","2544","0",USDC,2026-03-16T16:04:15.986Z,0,,FILL,"0.0126145074860029","0",0x1172e493de7bfca0ac8488ad3d73949ad46b2e315f2f0892b73896fde618b43,"0.03847499",["interactive"],1175301,1773677055980201709239930001
FILL-9999,BUY,MAKER,DIME-USD,1,"1","1","0",USDC,2026-01-01T00:00:00.000Z,0,,CANCELLED,"0","0",0x1172,"1",[],1,9999
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("paradex");
    expect(r.drafts).toHaveLength(1);
    const draft = r.drafts[0]!;
    expect(draft.type).toBe("VENTE");
    expect(draft.ticker).toBe("DIME");
    expect(draft.quantity).toBe("2544");
  });

  it("extracts option strike/kind into notes and keeps dates as UTC ISO", () => {
    const csv = `${HEADERS}
FILL-1761373103450201709229090030,SELL,MAKER,BTC-USD-118000-C,1761316883430201709276060001,"252.1","0.119","-1.3260019987438993",USDC,2025-10-25T06:18:23.468Z,0,,FILL,"-20.1615808740119928","-54.60746473",0x1172e493de7bfca0ac8488ad3d73949ad46b2e315f2f0892b73896fde618b43,"111416.25744028",["interactive"],6295406,1761373103450201709229090030
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("paradex");
    expect(r.drafts).toHaveLength(1);
    const draft = r.drafts[0]!;
    expect(draft.ticker).toBe("BTC");
    expect(draft.notes).toContain("OPTION_CALL");
    expect(draft.notes).toContain("strike 118000");
    expect(draft.occurredAt).toContain("2025-10-25");
  });
});
