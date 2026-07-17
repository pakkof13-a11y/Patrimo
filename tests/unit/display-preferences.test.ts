import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  COLUMN_RESIZE_MAX,
  COLUMN_RESIZE_MIN,
  HOLDINGS_COLUMN_META,
  columnMinWidth,
  compareAssetNames,
  computeFlexColumnLayout,
  defaultColumnOrder,
  defaultColumnSizing,
  defaultHoldingsVisibility,
  loadColumnOrder,
  loadColumnSizing,
  loadColumnVisibility,
  preferredColumnMins,
  reorderColumnIds,
  resetHoldingsColumns,
  sanitizeColumnOrder,
  sanitizeColumnVisibility,
  sanitizeLockedSizing,
  saveColumnOrder,
  saveColumnSizing,
} from "../../app/lib/display-preferences";

describe("compareAssetNames", () => {
  it("sorts L'Oréal before LVMH (ignores apostrophe)", () => {
    expect(compareAssetNames("L'Oréal", "LVMH")).toBeLessThan(0);
    expect(compareAssetNames("L’Oréal", "LVMH")).toBeLessThan(0); // typographic ’
    expect(compareAssetNames("LVMH", "L'Oréal")).toBeGreaterThan(0);
  });

  it("is case and accent insensitive (base sensitivity)", () => {
    expect(compareAssetNames("airbus", "Airbus")).toBe(0);
    expect(compareAssetNames("Électricité", "electricite")).toBe(0);
  });
});

describe("mandatory / optional column defaults", () => {
  it("shows only mandatory columns by default and locks them", () => {
    const vis = defaultHoldingsVisibility();
    for (const c of HOLDINGS_COLUMN_META) {
      expect(vis[c.id]).toBe(c.group === "mandatory");
      if (c.group === "mandatory") expect(c.locked).toBe(true);
    }
    expect(vis.ticker).toBe(true);
    expect(vis.currency).toBe(false);
    expect(vis.stopLoss).toBe(false);
    expect(HOLDINGS_COLUMN_META.find((c) => c.id === "tp1")?.label).toBe("TP1");
  });

  it("orders mandatory then optional, alpha by label within each group", () => {
    const order = defaultColumnOrder();
    const mandatory = HOLDINGS_COLUMN_META.filter((c) => c.group === "mandatory").map(
      (c) => c.id
    );
    const optional = HOLDINGS_COLUMN_META.filter((c) => c.group === "optional").map(
      (c) => c.id
    );
    expect(order.slice(0, mandatory.length).sort()).toEqual([...mandatory].sort());
    expect(order.slice(mandatory.length).sort()).toEqual([...optional].sort());
    // first mandatory by fr label should be Actif
    expect(order[0]).toBe("name");
    // ticker is mandatory and present
    expect(order).toContain("ticker");
    // stop loss after all mandatory
    expect(order.indexOf("stopLoss")).toBeGreaterThan(order.indexOf("ticker"));
  });

  it("resetHoldingsColumns restores mandatory visibility + default order", () => {
    const r = resetHoldingsColumns();
    expect(r.order).toEqual(defaultColumnOrder());
    for (const c of HOLDINGS_COLUMN_META) {
      expect(r.visibility[c.id]).toBe(c.group === "mandatory" || Boolean(c.locked));
    }
  });
});

describe("reorderColumnIds", () => {
  it("moves id to target position", () => {
    expect(reorderColumnIds(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("is a no-op for unknown ids", () => {
    expect(reorderColumnIds(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });

  it("is a no-op when from === to", () => {
    expect(reorderColumnIds(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});

describe("defaultColumnSizing", () => {
  it("starts empty (no locks → full flex-fill)", () => {
    expect(defaultColumnSizing()).toEqual({});
    expect(resetHoldingsColumns().sizing).toEqual({});
  });

  it("preferredColumnMins covers every meta column with min floor", () => {
    const s = preferredColumnMins();
    const order = defaultColumnOrder();
    expect(Object.keys(s).sort()).toEqual([...order].sort());
    for (const [id, v] of Object.entries(s)) {
      expect(v).toBe(columnMinWidth(id));
      expect(v).toBeGreaterThanOrEqual(COLUMN_RESIZE_MIN);
      expect(v).toBeLessThanOrEqual(COLUMN_RESIZE_MAX);
    }
  });
});

describe("computeFlexColumnLayout", () => {
  const ids = ["a", "b", "c"];
  const minOf = (id: string) => (id === "a" ? 100 : id === "b" ? 80 : 120);

  it("fills container when mins fit (no empty right gap)", () => {
    const { sizes, tableWidth, contentWidth } = computeFlexColumnLayout({
      containerWidth: 600,
      expandPx: 44,
      columnIds: ids,
      locked: {},
      minWidthOf: minOf,
    });
    // available = 556; mins = 300; leftover 256 shared
    expect(contentWidth).toBe(556);
    expect(tableWidth).toBe(600);
    expect(sizes.a! + sizes.b! + sizes.c!).toBe(556);
    expect(sizes.a).toBeGreaterThanOrEqual(100);
    expect(sizes.b).toBeGreaterThanOrEqual(80);
    expect(sizes.c).toBeGreaterThanOrEqual(120);
  });

  it("keeps mins and overflows when container is too narrow", () => {
    const { sizes, tableWidth, contentWidth } = computeFlexColumnLayout({
      containerWidth: 200,
      expandPx: 44,
      columnIds: ids,
      locked: {},
      minWidthOf: minOf,
    });
    expect(sizes.a).toBe(100);
    expect(sizes.b).toBe(80);
    expect(sizes.c).toBe(120);
    expect(contentWidth).toBe(300);
    expect(tableWidth).toBe(344); // 300 + 44 expand
  });

  it("locks resized column and flexes the others", () => {
    const { sizes, contentWidth } = computeFlexColumnLayout({
      containerWidth: 600,
      expandPx: 0,
      columnIds: ids,
      locked: { a: 250 },
      minWidthOf: minOf,
    });
    expect(sizes.a).toBe(250);
    expect(sizes.b! + sizes.c!).toBe(contentWidth - 250);
    expect(sizes.b).toBeGreaterThanOrEqual(80);
    expect(sizes.c).toBeGreaterThanOrEqual(120);
  });
});

describe("localStorage column prefs", () => {
  const mem = new Map<string, string>();

  beforeEach(() => {
    mem.clear();
    // minimal localStorage mock for node/vitest
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, String(v));
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      },
    });
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.localStorage;
  });

  it("persists and reloads column order", () => {
    const order = ["name", "quantity", "avgCostEur"];
    // full order is required for load merge — save partial then load appends missing
    saveColumnOrder("holdings", order);
    const loaded = loadColumnOrder("holdings");
    expect(loaded[0]).toBe("name");
    expect(loaded).toContain("quantity");
    expect(loaded.length).toBe(defaultColumnOrder().length);
  });

  it("clamps locked column sizing on save/load (v5 partial map)", () => {
    saveColumnSizing("holdings", { name: 10, avgCostEur: 9999, quantity: 150 });
    const loaded = loadColumnSizing("holdings");
    // name floor is meta minWidth (160), not global 80
    expect(loaded.name).toBe(columnMinWidth("name"));
    expect(loaded.avgCostEur).toBe(COLUMN_RESIZE_MAX);
    expect(loaded.quantity).toBe(150);
    // only locked keys are stored (no auto-seed of every column)
    expect(Object.keys(loaded).sort()).toEqual(
      ["avgCostEur", "name", "quantity"].sort()
    );
  });

  it("resets visibility when stored blob is corrupt", () => {
    mem.set(
      "patrimo.display.columns.holdings.v4",
      JSON.stringify({ totally: "wrong", schema: 1 })
    );
    const fallback = defaultHoldingsVisibility();
    const loaded = loadColumnVisibility("holdings", fallback);
    expect(loaded).toEqual(fallback);
    // corrupt key wiped
    expect(mem.get("patrimo.display.columns.holdings.v4")).toBeUndefined();
  });

  it("resets order when stored value is not an array", () => {
    mem.set(
      "patrimo.display.columnOrder.holdings.v4",
      JSON.stringify({ not: "array" })
    );
    expect(loadColumnOrder("holdings")).toEqual(defaultColumnOrder());
  });

  it("ignores non-boolean visibility values", () => {
    const fallback = defaultHoldingsVisibility("standard");
    mem.set(
      "patrimo.display.columns.holdings.v4",
      JSON.stringify({ ...fallback, quantity: "yes", currency: false })
    );
    const loaded = loadColumnVisibility("holdings", fallback);
    expect(loaded.currency).toBe(false);
    // invalid type keeps fallback
    expect(loaded.quantity).toBe(fallback.quantity);
  });

  it("keeps locked columns always visible", () => {
    const fallback = defaultHoldingsVisibility("standard");
    mem.set(
      "patrimo.display.columns.holdings.v4",
      JSON.stringify({ ...fallback, name: false, marketValueBase: false })
    );
    const loaded = loadColumnVisibility("holdings", fallback);
    expect(loaded.name).toBe(true);
    expect(loaded.marketValueBase).toBe(true);
  });
});

describe("sanitize column prefs", () => {
  it("sanitizeColumnVisibility forces mandatory on", () => {
    const fallback = defaultHoldingsVisibility();
    const s = sanitizeColumnVisibility(
      { name: false, currency: true, unknownCol: true },
      fallback
    );
    expect(s).not.toBeNull();
    expect(s!.name).toBe(true); // mandatory
    expect(s!.currency).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(s, "unknownCol")
    ).toBe(false);
  });

  it("sanitizeColumnVisibility returns null for unusable object", () => {
    const fallback = defaultHoldingsVisibility();
    expect(sanitizeColumnVisibility({ foo: "bar" }, fallback)).toBeNull();
    expect(sanitizeColumnVisibility(null, fallback)).toBeNull();
    expect(sanitizeColumnVisibility([], fallback)).toBeNull();
  });

  it("sanitizeColumnOrder dedupes and appends missing", () => {
    const order = sanitizeColumnOrder(["quantity", "name", "quantity", "nope"]);
    expect(order).not.toBeNull();
    expect(order![0]).toBe("quantity");
    expect(order![1]).toBe("name");
    expect(order).toContain("ticker");
    expect(order!.filter((x) => x === "quantity")).toHaveLength(1);
  });

  it("sanitizeLockedSizing clamps and drops junk", () => {
    const s = sanitizeLockedSizing({
      name: 10,
      avgCostEur: 9999,
      ghost: 100,
      quantity: "nope",
    });
    expect(s).not.toBeNull();
    expect(s!.name).toBe(columnMinWidth("name"));
    expect(s!.avgCostEur).toBe(COLUMN_RESIZE_MAX);
    expect(s!.ghost).toBeUndefined();
    expect(s!.quantity).toBeUndefined();
  });
});
