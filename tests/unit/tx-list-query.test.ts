import { describe, expect, it } from "vitest";
import {
  buildTxListOrderBy,
  buildTxListWhere,
  computeTxKpis,
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

describe("filtre de dates (dateFrom / dateTo)", () => {
  it("parse un format YYYY-MM-DD valide", () => {
    const q = parseTxListQuery(
      new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-03-31")
    );
    expect(q.dateFrom).toBe("2026-01-01");
    expect(q.dateTo).toBe("2026-03-31");
  });

  it("ignore un format invalide plutôt que de planter", () => {
    const q = parseTxListQuery(
      new URLSearchParams("dateFrom=01/01/2026&dateTo=not-a-date")
    );
    expect(q.dateFrom).toBeNull();
    expect(q.dateTo).toBeNull();
  });

  it("absent → null, aucune borne appliquée au where", () => {
    const query = parseTxListQuery(new URLSearchParams());
    expect(query.dateFrom).toBeNull();
    expect(query.dateTo).toBeNull();
    const where = buildTxListWhere("u", query);
    expect(where.occurredAt).toBeUndefined();
  });

  it("dateFrom seul → borne basse uniquement (début de journée UTC)", () => {
    const query = parseTxListQuery(new URLSearchParams("dateFrom=2026-06-15"));
    const where = buildTxListWhere("u", query);
    expect(where.occurredAt).toEqual({
      gte: new Date("2026-06-15T00:00:00.000Z"),
    });
  });

  it("dateTo seul → borne haute inclusive (fin de journée UTC)", () => {
    const query = parseTxListQuery(new URLSearchParams("dateTo=2026-06-15"));
    const where = buildTxListWhere("u", query);
    expect(where.occurredAt).toEqual({
      lte: new Date("2026-06-15T23:59:59.999Z"),
    });
  });

  it("les deux bornes ensemble", () => {
    const query = parseTxListQuery(
      new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31")
    );
    const where = buildTxListWhere("u", query);
    expect(where.occurredAt).toEqual({
      gte: new Date("2026-01-01T00:00:00.000Z"),
      lte: new Date("2026-01-31T23:59:59.999Z"),
    });
  });
});

describe("computeTxKpis", () => {
  it("achats/ventes en brut (grossAmountEur), frais et revenus séparés", () => {
    const kpis = computeTxKpis([
      {
        type: "ACHAT",
        _sum: { grossAmountEur: 1000, feesEur: 5, netCashImpactEur: 0 },
      },
      {
        type: "VENTE",
        _sum: { grossAmountEur: 400, feesEur: 2, netCashImpactEur: 0 },
      },
      {
        type: "DIVIDENDE",
        _sum: { grossAmountEur: 50, feesEur: 0, netCashImpactEur: 45 },
      },
      {
        type: "COUPON",
        _sum: { grossAmountEur: 10, feesEur: 0, netCashImpactEur: 10 },
      },
      {
        type: "FRAIS",
        _sum: { grossAmountEur: 0, feesEur: 3, netCashImpactEur: -3 },
      },
    ]);
    expect(kpis.buysEur).toBe(1000);
    expect(kpis.sellsEur).toBe(400);
    expect(kpis.feesEur).toBe(10); // 5 + 2 + 0 + 0 + 3
    expect(kpis.incomeEur).toBe(55); // 45 + 10 (DIVIDENDE + COUPON net)
  });

  it("compte les REWARD dans les revenus via grossAmountEur (FMV), pas netCashImpactEur (toujours 0)", () => {
    const kpis = computeTxKpis([
      {
        type: "DIVIDENDE",
        _sum: { grossAmountEur: 50, feesEur: 0, netCashImpactEur: 45 },
      },
      {
        type: "REWARD",
        _sum: { grossAmountEur: 30, feesEur: 0, netCashImpactEur: 0 },
      },
      {
        // AIRDROP reste hors "Revenus" — distinct de reward.
        type: "AIRDROP",
        _sum: { grossAmountEur: 20, feesEur: 0, netCashImpactEur: 0 },
      },
    ]);
    expect(kpis.incomeEur).toBe(75); // 45 (DIVIDENDE net) + 30 (REWARD FMV)
  });

  it("gère les _sum null (aucune ligne pour ce type) sans planter", () => {
    const kpis = computeTxKpis([
      {
        type: "ACHAT",
        _sum: { grossAmountEur: null, feesEur: null, netCashImpactEur: null },
      },
    ]);
    expect(kpis.buysEur).toBe(0);
    expect(kpis.feesEur).toBe(0);
  });

  it("liste vide → tous les totaux à 0", () => {
    const kpis = computeTxKpis([]);
    expect(kpis).toEqual({
      buysEur: 0,
      sellsEur: 0,
      feesEur: 0,
      incomeEur: 0,
    });
  });
});

describe("filtre plateforme (platformId)", () => {
  it("absent → aucune clause supplémentaire", () => {
    const query = parseTxListQuery(new URLSearchParams());
    expect(query.platformId).toBeNull();
  });

  it("matche la plateforme source OU destination (transfert)", () => {
    const query = parseTxListQuery(
      new URLSearchParams("platformId=plat-1")
    );
    expect(query.platformId).toBe("plat-1");
    const where = buildTxListWhere("u", query);
    const and = where.AND as Array<{ OR?: unknown[] }>;
    expect(and).toContainEqual({
      OR: [{ platformId: "plat-1" }, { toPlatformId: "plat-1" }],
    });
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

  it("un airdrop ne compte que dans le badge airdrop, pas aussi dans reward", () => {
    const out = mapTypeCountsToGroups([
      { type: "REWARD", _count: 5 },
      { type: "AIRDROP", _count: 2 },
    ]);
    expect(out.reward).toBe(5);
    expect(out.airdrop).toBe(2);
    expect(out.all).toBe(7);
  });

  it("les travaux (TRAVAUX) sont comptés dans le groupe works", () => {
    const out = mapTypeCountsToGroups([{ type: "TRAVAUX", _count: 4 }]);
    expect(out.works).toBe(4);
  });
});
