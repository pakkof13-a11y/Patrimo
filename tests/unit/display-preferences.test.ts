import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  COLUMN_RESIZE_MAX,
  COLUMN_RESIZE_MIN,
  HOLDINGS_COLUMN_META,
  columnAlign,
  columnLabel,
  columnMeta,
  columnMinWidth,
  columnOrderStorageKey,
  columnsStorageKey,
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
      /*
        `locked` est plus fort que `mandatory`, et non son synonyme : une
        colonne verrouillée est visible par défaut *et* indécochable. La
        réciproque est fausse — la vignette de tendance s'affiche d'emblée
        mais reste décochable, puisqu'elle ne porte aucun chiffre sans lequel
        la ligne cesserait d'être lisible.
      */
      if (c.locked) expect(c.group).toBe("mandatory");
    }
    expect(HOLDINGS_COLUMN_META.find((c) => c.id === "trend")?.locked).toBe(
      undefined
    );
    expect(vis.trend).toBe(true);
    // Ticker et PRU sont désormais optionnels (accessibles en un clic) — le
    // socle par défaut ne garde que ce qui est indispensable à la lecture
    // d'une position (Actif, Enveloppe, Cours, Valeur, P&L, Quantité, Plateforme).
    expect(vis.ticker).toBe(false);
    expect(vis.avgCostEur).toBe(false);
    expect(vis.quantity).toBe(true);
    // La plateforme a quitté le socle obligatoire : elle répond à « où est-ce
    // gardé ? », question de garde que le panneau de détail et les modes
    // Analyse / Expert traitent, pas la lecture de synthèse.
    expect(vis.platformName).toBe(false);
    expect(vis.currency).toBe(false);
    expect(vis.stopLoss).toBe(false);
    expect(HOLDINGS_COLUMN_META.find((c) => c.id === "tp1")?.label).toBe("TP1");
  });

  it("suit l'ordre de lecture d'une position, pas l'alphabet", () => {
    const order = defaultColumnOrder();

    /*
      L'ordre raconte une phrase : quoi, combien, ce que ça vaut, ce que ça a
      fait, ce que ça pèse. L'alphabet plaçait « Cours » avant « Enveloppe » et
      « PRU » après « Allocation » — chaque colonne à sa place dans le
      dictionnaire, aucune dans le raisonnement.
    */
    expect(order.slice(0, 11)).toEqual([
      "name",
      "ticker",
      "accountType",
      "quantity",
      "avgCostEur",
      "currentPriceNative",
      "marketValueBase",
      // La vignette se lit entre la valeur et ce qu'elle a fait : elle dit par
      // quel chemin le P&L qui suit est arrivé là.
      "trend",
      "unrealizedPnlBase",
      "unrealizedPnlPct",
      "allocationPct",
    ]);
  });

  it("range les colonnes restantes par ordre alphabétique, sans en perdre", () => {
    const order = defaultColumnOrder();
    const all = HOLDINGS_COLUMN_META.map((c) => c.id);

    // Aucune colonne oubliée, aucun identifiant fantôme.
    expect([...order].sort()).toEqual([...all].sort());
    expect(new Set(order).size).toBe(order.length);

    // La queue suit le libellé : une colonne ajoutée demain s'y range seule.
    const tail = order.slice(11);
    const labels = tail.map(
      (id) => HOLDINGS_COLUMN_META.find((c) => c.id === id)!.label
    );
    const sorted = [...labels].sort((a, b) =>
      a.localeCompare(b, "fr", { sensitivity: "base", numeric: true })
    );
    expect(labels).toEqual(sorted);
  });

  it("resetHoldingsColumns restores mandatory visibility + default order", () => {
    const r = resetHoldingsColumns();
    expect(r.order).toEqual(defaultColumnOrder());
    for (const c of HOLDINGS_COLUMN_META) {
      expect(r.visibility[c.id]).toBe(c.group === "mandatory" || Boolean(c.locked));
    }
  });
});

describe("index des colonnes", () => {
  it("résout chaque colonne de la méta, et rien d'autre", () => {
    /*
      L'index est construit une fois au chargement du module. S'il venait à
      être déclaré avant le tableau qu'il indexe, ou à ne plus le refléter,
      il rendrait `undefined` partout — et les colonnes retomberaient
      silencieusement sur leurs valeurs de repli : largeur 100, alignement à
      gauche, libellé remplacé par l'identifiant.
    */
    for (const c of HOLDINGS_COLUMN_META) {
      expect(columnMeta(c.id)).toBe(c);
      expect(columnLabel(c.id)).toBe(c.label);
      expect(columnAlign(c.id)).toBe(c.align);
    }
    expect(columnMeta("colonne-inexistante")).toBeUndefined();
    expect(columnLabel("colonne-inexistante")).toBe("colonne-inexistante");
  });

  it("les nombres sont alignés à droite, l'actif à gauche", () => {
    expect(columnAlign("unrealizedPnlBase")).toBe("right");
    expect(columnAlign("marketValueBase")).toBe("right");
    expect(columnAlign("quantity")).toBe("right");
    // Pastille et vignette sont centrées ; le nom de l'actif reste à gauche.
    expect(columnAlign("accountType")).toBe("center");
    expect(columnAlign("trend")).toBe("center");
    expect(columnAlign("name")).toBeUndefined();
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
      columnsStorageKey("holdings"),
      JSON.stringify({ totally: "wrong", schema: 1 })
    );
    const fallback = defaultHoldingsVisibility();
    const loaded = loadColumnVisibility("holdings", fallback);
    expect(loaded).toEqual(fallback);
    // corrupt key wiped
    expect(mem.get(columnsStorageKey("holdings"))).toBeUndefined();
  });

  it("resets order when stored value is not an array", () => {
    mem.set(
      columnOrderStorageKey("holdings"),
      JSON.stringify({ not: "array" })
    );
    expect(loadColumnOrder("holdings")).toEqual(defaultColumnOrder());
  });

  it("ignores non-boolean visibility values", () => {
    const fallback = defaultHoldingsVisibility("standard");
    mem.set(
      columnsStorageKey("holdings"),
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
      columnsStorageKey("holdings"),
      JSON.stringify({ ...fallback, name: false, marketValueBase: false })
    );
    const loaded = loadColumnVisibility("holdings", fallback);
    expect(loaded.name).toBe(true);
    expect(loaded.marketValueBase).toBe(true);
  });
});

describe("sanitize column prefs", () => {
  it("sanitizeColumnVisibility forces locked on, respecte le reste", () => {
    const fallback = defaultHoldingsVisibility();
    const s = sanitizeColumnVisibility(
      { name: false, currency: true, trend: false, unknownCol: true },
      fallback
    );
    expect(s).not.toBeNull();
    expect(s!.name).toBe(true); // verrouillée : indécochable
    // Affichée par défaut mais décochable : le réglage doit survivre au
    // rechargement, sinon il s'annule tout seul d'une visite à l'autre.
    expect(s!.trend).toBe(false);
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
