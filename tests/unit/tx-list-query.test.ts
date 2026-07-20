import { describe, expect, it } from "vitest";
import {
  buildTxListOrderBy,
  buildTxListWhere,
  mapTypeCountsToGroups,
  parseTxListQuery,
  resolveTypeFilter,
  TX_LIST_DEFAULT_PAGE_SIZE,
  TX_LIST_MAX_PAGE_SIZE,
} from "@/app/lib/transactions/list-query";

describe("parseTxListQuery", () => {
  it("applique les défauts page/pageSize", () => {
    const q = parseTxListQuery(new URLSearchParams());
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(TX_LIST_DEFAULT_PAGE_SIZE);
    expect(q.typeGroup).toBe("all");
    expect(q.sortBy).toBe("date");
    expect(q.sortDir).toBe("desc");
  });

  it("lit sortBy / sortDir", () => {
    const q = parseTxListQuery(
      new URLSearchParams("sortBy=asset&sortDir=asc")
    );
    expect(q.sortBy).toBe("asset");
    expect(q.sortDir).toBe("asc");
    const order = buildTxListOrderBy(q);
    expect(order[0]).toEqual({ asset: { name: "asc" } });
  });

  it("plafonne pageSize et page ≥ 1", () => {
    const q = parseTxListQuery(
      new URLSearchParams("page=0&pageSize=999&typeGroup=buy")
    );
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(TX_LIST_MAX_PAGE_SIZE);
    expect(q.typeGroup).toBe("buy");
  });

  it("lit accountType, q et type exact", () => {
    const q = parseTxListQuery(
      new URLSearchParams("accountType=pea&q=lvmh&type=ACHAT")
    );
    expect(q.accountType).toBe("PEA");
    expect(q.q).toBe("lvmh");
    expect(q.typeExact).toBe("ACHAT");
  });
});

describe("resolveTypeFilter / buildTxListWhere", () => {
  it("mappe typeGroup dividend → plusieurs types", () => {
    const types = resolveTypeFilter(
      parseTxListQuery(new URLSearchParams("typeGroup=dividend"))
    );
    expect(types).toEqual(
      expect.arrayContaining(["DIVIDENDE", "COUPON", "LOYER", "INTERET"])
    );
  });

  it("type exact prime sur typeGroup", () => {
    const types = resolveTypeFilter(
      parseTxListQuery(
        new URLSearchParams("typeGroup=buy&type=VENTE")
      )
    );
    expect(types).toEqual(["VENTE"]);
  });

  it("construit where userId + type + enveloppe + q", () => {
    const query = parseTxListQuery(
      new URLSearchParams("typeGroup=sell&accountType=CTO&q=BNP")
    );
    const where = buildTxListWhere("user-1", query);
    expect(where.userId).toBe("user-1");
    expect(where.type).toBe("VENTE");
    expect(where.asset).toEqual({ accountType: "CTO" });
    expect(Array.isArray(where.OR)).toBe(true);
  });

  it("omitTypeFilter ignore le filtre de type (pour typeCounts)", () => {
    const query = parseTxListQuery(
      new URLSearchParams("typeGroup=buy&accountType=PEA")
    );
    const where = buildTxListWhere("u", query, { omitTypeFilter: true });
    expect(where.type).toBeUndefined();
    expect(where.asset).toEqual({ accountType: "PEA" });
  });
});

describe("mapTypeCountsToGroups", () => {
  it("agrège les familles", () => {
    const out = mapTypeCountsToGroups([
      { type: "ACHAT", _count: 10 },
      { type: "VENTE", _count: 3 },
      { type: "DIVIDENDE", _count: 2 },
      { type: "COUPON", _count: 1 },
    ]);
    expect(out.all).toBe(16);
    expect(out.buy).toBe(10);
    expect(out.sell).toBe(3);
    expect(out.dividend).toBe(3);
  });
});
