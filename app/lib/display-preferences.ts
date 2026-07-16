/**
 * Display preferences: fluid shell + column visibility/order (localStorage).
 */

export type LayoutWidthMode = "fluid" | "standard" | "wide" | "ultra";

export const LAYOUT_WIDTH_OPTIONS: {
  id: LayoutWidthMode;
  label: string;
  description: string;
  /** CSS max-width (always with width: min(95vw, …) via shell) */
  maxWidth: string;
  /** Prefer fluid width: 95% of viewport */
  fluid: boolean;
}[] = [
  {
    id: "fluid",
    label: "Fluide auto-adaptatif (recommandé)",
    description: "95 % de l’écran · plafond 2560px — s’étire avec la résolution",
    maxWidth: "2560px",
    fluid: true,
  },
  {
    id: "standard",
    label: "Standard (plafond 1500px)",
    description: "Toujours 95 % de l’écran, plafonné à 1500px",
    maxWidth: "1500px",
    fluid: true,
  },
  {
    id: "wide",
    label: "Grand écran (plafond 1920px)",
    description: "95 % de l’écran, plafonné à 1920px",
    maxWidth: "1920px",
    fluid: true,
  },
  {
    id: "ultra",
    label: "Ultra-large (plafond 2560px)",
    description: "95 % de l’écran, plafonné à 2560px — 21:9",
    maxWidth: "2560px",
    fluid: true,
  },
];

const LAYOUT_KEY = "patrimo.display.layoutWidth";
const COLUMNS_PREFIX = "patrimo.display.columns.";
const ORDER_PREFIX = "patrimo.display.columnOrder.";
const SIZE_PREFIX = "patrimo.display.columnSizing.";
/** Bumped when default mandatory/optional set changes (Ticker + reset rules). */
const COLUMNS_VERSION = "v4";
/**
 * Sizing v5: only stores *user-locked* column widths (manual resize / autosize).
 * Unlocked columns flex-fill the remaining space (no empty right margin).
 */
const SIZING_VERSION = "v5";

/** Absolute floor when user drags a column smaller (px) */
export const COLUMN_RESIZE_MIN = 80;
/** Cap to avoid runaway widths */
export const COLUMN_RESIZE_MAX = 640;
/** Extra padding applied by double-click autosize (px) */
export const COLUMN_AUTOSIZE_PAD = 24;

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

export function loadLayoutWidth(): LayoutWidthMode {
  if (!canUseStorage()) return "fluid";
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === "fluid" || v === "standard" || v === "wide" || v === "ultra") return v;
    // migrate old default
    if (v === null) return "fluid";
  } catch {
    /* ignore */
  }
  return "fluid";
}

export function saveLayoutWidth(mode: LayoutWidthMode) {
  try {
    localStorage.setItem(LAYOUT_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function layoutMaxWidth(mode: LayoutWidthMode): string {
  return LAYOUT_WIDTH_OPTIONS.find((o) => o.id === mode)?.maxWidth ?? "2560px";
}

/**
 * Holdings columns — ids must match TanStack column `id`.
 *
 * - `mandatory` → visible by default and on reset
 * - `optional`  → hidden by default and on reset
 * - `locked`    → always visible (cannot hide in picker)
 *
 * Default display order = alphabetical (fr) within mandatory, then optional.
 */
export type HoldingsColumnGroup = "mandatory" | "optional";

export type HoldingsColumnMeta = {
  id: string;
  label: string;
  group: HoldingsColumnGroup;
  locked?: boolean;
  /** Min width for fluid table cells (px) */
  minWidth?: number;
};

export const HOLDINGS_COLUMN_META: HoldingsColumnMeta[] = [
  // —— MANDATORY (always visible, checkbox locked) ——
  { id: "name", label: "Actif", group: "mandatory", locked: true, minWidth: 160 },
  {
    id: "currentPriceNative",
    label: "Cours actuel",
    group: "mandatory",
    locked: true,
    minWidth: 110,
  },
  {
    id: "unrealizedPnlBase",
    label: "P&L latent (€)",
    group: "mandatory",
    locked: true,
    minWidth: 110,
  },
  {
    id: "unrealizedPnlPct",
    label: "P&L latent (%)",
    group: "mandatory",
    locked: true,
    minWidth: 100,
  },
  {
    id: "platformName",
    label: "Plateforme",
    group: "mandatory",
    locked: true,
    minWidth: 120,
  },
  { id: "avgCostEur", label: "PRU", group: "mandatory", locked: true, minWidth: 100 },
  { id: "quantity", label: "Quantité", group: "mandatory", locked: true, minWidth: 96 },
  { id: "ticker", label: "Ticker", group: "mandatory", locked: true, minWidth: 88 },
  {
    id: "accountType",
    label: "Type de compte",
    group: "mandatory",
    locked: true,
    minWidth: 120,
  },
  {
    id: "marketValueBase",
    label: "Valeur totale",
    group: "mandatory",
    locked: true,
    minWidth: 120,
  },
  // —— OPTIONAL (togglable, hidden by default) ——
  { id: "allocationPctOfClass", label: "Allocation (%)", group: "optional", minWidth: 110 },
  {
    id: "allocationPct",
    label: "Allocation portefeuille (%)",
    group: "optional",
    minWidth: 120,
  },
  {
    id: "breakEvenBase",
    label: "Break-even / Seuil de rentabilité",
    group: "optional",
    minWidth: 120,
  },
  { id: "costBasisEur", label: "Capital investi", group: "optional", minWidth: 110 },
  { id: "assetClass", label: "Classe", group: "optional", minWidth: 100 },
  { id: "lastUpdatedAt", label: "Dernière mise à jour", group: "optional", minWidth: 120 },
  { id: "currency", label: "Devise", group: "optional", minWidth: 88 },
  {
    id: "passiveIncomeBase",
    label: "Dividendes / Rendement cumulé",
    group: "optional",
    minWidth: 130,
  },
  {
    id: "acquisitionFeesBase",
    label: "Frais de transaction",
    group: "optional",
    minWidth: 110,
  },
  { id: "stopLoss", label: "Stop Loss", group: "optional", minWidth: 100 },
  { id: "tp1", label: "TP1", group: "optional", minWidth: 88 },
  { id: "tp2", label: "TP2", group: "optional", minWidth: 88 },
  { id: "tp3", label: "TP3", group: "optional", minWidth: 88 },
  { id: "tp4", label: "TP4", group: "optional", minWidth: 88 },
];

const MANDATORY_IDS = new Set(
  HOLDINGS_COLUMN_META.filter((c) => c.group === "mandatory").map((c) => c.id)
);

function sortColumnsByLabel(cols: HoldingsColumnMeta[]): HoldingsColumnMeta[] {
  return [...cols].sort((a, b) =>
    a.label.localeCompare(b.label, "fr", { sensitivity: "base", numeric: true })
  );
}

/** Alphabetical (fr) within mandatory, then optional — initial & reset order. */
export function defaultColumnOrder(): string[] {
  const mandatory = sortColumnsByLabel(
    HOLDINGS_COLUMN_META.filter((c) => c.group === "mandatory")
  ).map((c) => c.id);
  const optional = sortColumnsByLabel(
    HOLDINGS_COLUMN_META.filter((c) => c.group === "optional")
  ).map((c) => c.id);
  return [...mandatory, ...optional];
}

export const DEFAULT_COLUMN_ORDER = defaultColumnOrder();

export type ColumnVisibilityMap = Record<string, boolean>;

/**
 * Initial visibility: only MANDATORY columns checked.
 * Layout width no longer expands the default set.
 */
export function defaultHoldingsVisibility(
  _mode: LayoutWidthMode = "fluid"
): ColumnVisibilityMap {
  const map: ColumnVisibilityMap = {};
  for (const c of HOLDINGS_COLUMN_META) {
    map[c.id] = c.group === "mandatory" || Boolean(c.locked);
  }
  return map;
}

/**
 * Reset: mandatory → visible, optional → hidden, order → alpha per group.
 * Also used by ColumnPicker "Réinitialiser".
 */
export function resetHoldingsColumns(): {
  visibility: ColumnVisibilityMap;
  order: string[];
  sizing: Record<string, number>;
} {
  const visibility: ColumnVisibilityMap = {};
  for (const c of HOLDINGS_COLUMN_META) {
    if (MANDATORY_IDS.has(c.id) || c.locked) {
      visibility[c.id] = true;
    } else {
      visibility[c.id] = false;
    }
  }
  return {
    visibility,
    order: defaultColumnOrder(),
    sizing: defaultColumnSizing(),
  };
}

export function loadColumnVisibility(
  tableKey: string,
  fallback: ColumnVisibilityMap
): ColumnVisibilityMap {
  if (!canUseStorage()) return fallback;
  try {
    const raw = localStorage.getItem(`${COLUMNS_PREFIX}${tableKey}.${COLUMNS_VERSION}`);
    const legacy = localStorage.getItem(COLUMNS_PREFIX + tableKey);
    const source = raw || legacy;
    if (!source) return fallback;
    const parsed = JSON.parse(source) as ColumnVisibilityMap;
    const merged: ColumnVisibilityMap = { ...fallback };
    for (const [k, v] of Object.entries(parsed)) {
      if (k in fallback && typeof v === "boolean") merged[k] = v;
    }
    // Mandatory / locked columns always stay visible
    for (const c of HOLDINGS_COLUMN_META) {
      if (c.group === "mandatory" || c.locked) merged[c.id] = true;
    }
    return merged;
  } catch {
    return fallback;
  }
}

export function saveColumnVisibility(tableKey: string, visibility: ColumnVisibilityMap) {
  try {
    localStorage.setItem(
      `${COLUMNS_PREFIX}${tableKey}.${COLUMNS_VERSION}`,
      JSON.stringify(visibility)
    );
  } catch {
    /* ignore */
  }
}

/** Merge saved order with any new columns appended at end */
export function loadColumnOrder(tableKey: string): string[] {
  const defaults = defaultColumnOrder();
  if (!canUseStorage()) return defaults;
  try {
    const raw = localStorage.getItem(`${ORDER_PREFIX}${tableKey}.${COLUMNS_VERSION}`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return defaults;
    const known = new Set(defaults);
    const order = parsed.filter((id) => known.has(id));
    for (const id of defaults) {
      if (!order.includes(id)) order.push(id);
    }
    return order;
  } catch {
    return defaults;
  }
}

export function saveColumnOrder(tableKey: string, order: string[]) {
  try {
    localStorage.setItem(
      `${ORDER_PREFIX}${tableKey}.${COLUMNS_VERSION}`,
      JSON.stringify(order)
    );
  } catch {
    /* ignore */
  }
}

/** Move `fromId` to the position of `toId` in an ordered id list. */
export function reorderColumnIds(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order;
  const next = [...order];
  const fromIdx = next.indexOf(fromId);
  const toIdx = next.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0) return order;
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, fromId);
  return next;
}

export function columnMinWidth(id: string): number {
  return Math.max(
    COLUMN_RESIZE_MIN,
    HOLDINGS_COLUMN_META.find((c) => c.id === id)?.minWidth ?? 100
  );
}

/**
 * Default sizing map = empty → no columns locked; layout flex-fills the table.
 * (Reset / first visit.)
 */
export function defaultColumnSizing(): Record<string, number> {
  return {};
}

/**
 * Preferred base widths (for docs / tests) = meta minWidth, clamped.
 * Not used as locks — only as min floor in flex layout.
 */
export function preferredColumnMins(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const c of HOLDINGS_COLUMN_META) {
    map[c.id] = columnMinWidth(c.id);
  }
  return map;
}

/**
 * Flex-fill column layout (auto-fit + min-width + locked overrides).
 *
 * - Unlocked columns share remaining space equally after mins (≈ flex: 1 1 0%).
 * - Locked columns keep their pixel width (manual resize / double-click autosize).
 * - If sum(mins + locks) > available width → table grows and parent scrolls (overflow-x).
 * - If sum < available → table width = container (no empty gap on the right).
 */
export function computeFlexColumnLayout(opts: {
  containerWidth: number;
  expandPx?: number;
  columnIds: string[];
  /** User-locked widths only (id → px) */
  locked: Record<string, number>;
  minWidthOf?: (id: string) => number;
}): { sizes: Record<string, number>; tableWidth: number; contentWidth: number } {
  const expandPx = opts.expandPx ?? 0;
  const minWidthOf = opts.minWidthOf ?? columnMinWidth;
  const containerWidth = Math.max(0, Math.floor(opts.containerWidth));
  const available = Math.max(0, containerWidth - expandPx);

  type Col = {
    id: string;
    min: number;
    locked: boolean;
    lockSize: number;
  };

  const cols: Col[] = opts.columnIds.map((id) => {
    const min = minWidthOf(id);
    const rawLock = opts.locked[id];
    if (rawLock != null && Number.isFinite(Number(rawLock))) {
      const lockSize = Math.min(
        COLUMN_RESIZE_MAX,
        Math.max(min, Math.round(Number(rawLock)))
      );
      return { id, min, locked: true, lockSize };
    }
    return { id, min, locked: false, lockSize: min };
  });

  const lockedSum = cols
    .filter((c) => c.locked)
    .reduce((s, c) => s + c.lockSize, 0);
  const flexCols = cols.filter((c) => !c.locked);
  const flexMinSum = flexCols.reduce((s, c) => s + c.min, 0);
  const totalMin = lockedSum + flexMinSum;

  const sizes: Record<string, number> = {};

  // Overflow: keep mins / locks, table wider than container → horizontal scroll
  if (totalMin >= available || available <= 0) {
    for (const c of cols) {
      sizes[c.id] = c.locked ? c.lockSize : c.min;
    }
    const contentWidth = totalMin;
    return {
      sizes,
      contentWidth,
      tableWidth: expandPx + contentWidth,
    };
  }

  // Fill container: distribute leftover equally across unlocked (flex) columns
  const leftover = available - totalMin;

  if (flexCols.length === 0) {
    // All locked — still fill the row by giving leftover to the last column
    for (const c of cols) sizes[c.id] = c.lockSize;
    if (cols.length > 0 && leftover > 0) {
      const last = cols[cols.length - 1]!;
      sizes[last.id] = Math.min(
        COLUMN_RESIZE_MAX,
        sizes[last.id]! + leftover
      );
    }
    return {
      sizes,
      contentWidth: available,
      tableWidth: expandPx + available,
    };
  }

  const baseExtra = Math.floor(leftover / flexCols.length);
  let remainder = leftover - baseExtra * flexCols.length;
  for (const c of cols) {
    if (c.locked) {
      sizes[c.id] = c.lockSize;
    } else {
      const bonus = baseExtra + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      sizes[c.id] = Math.min(COLUMN_RESIZE_MAX, c.min + bonus);
    }
  }

  return {
    sizes,
    contentWidth: available,
    tableWidth: expandPx + available,
  };
}

/** Load *locked* column widths only (v5). Empty = full flex auto-fit. */
export function loadColumnSizing(tableKey: string): Record<string, number> {
  if (!canUseStorage()) return defaultColumnSizing();
  try {
    const raw = localStorage.getItem(
      `${SIZE_PREFIX}${tableKey}.${SIZING_VERSION}`
    );
    if (!raw) return defaultColumnSizing();
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== "object") return defaultColumnSizing();
    const known = new Set(HOLDINGS_COLUMN_META.map((c) => c.id));
    const locked: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!known.has(k)) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      locked[k] = Math.min(
        COLUMN_RESIZE_MAX,
        Math.max(columnMinWidth(k), Math.round(n))
      );
    }
    return locked;
  } catch {
    return defaultColumnSizing();
  }
}

/** Persist only locked widths (v5). */
export function saveColumnSizing(
  tableKey: string,
  sizing: Record<string, number>
) {
  try {
    const clamped: Record<string, number> = {};
    const known = new Set(HOLDINGS_COLUMN_META.map((c) => c.id));
    for (const [k, v] of Object.entries(sizing)) {
      if (!known.has(k)) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      clamped[k] = Math.min(
        COLUMN_RESIZE_MAX,
        Math.max(columnMinWidth(k), Math.round(n))
      );
    }
    localStorage.setItem(
      `${SIZE_PREFIX}${tableKey}.${SIZING_VERSION}`,
      JSON.stringify(clamped)
    );
  } catch {
    /* ignore */
  }
}

/** Drag grip + sort chevron + gaps reserved inside header cells (px). */
const AUTOSIZE_HEADER_CHROME = 14 /* grip */ + 4 /* gap */ + 16 /* sort */ + 6 /* gap */;
/** Extra chrome for <select> cells (chevron / border). */
const AUTOSIZE_SELECT_CHROME = 36;
/** Real logos in body cells. */
const AUTOSIZE_LOGO_EXTRA = 40;

function horizontalPadding(cs: CSSStyleDeclaration): number {
  const l = Number.parseFloat(cs.paddingLeft) || 0;
  const r = Number.parseFloat(cs.paddingRight) || 0;
  return l + r;
}

function measureTextWidth(
  probe: HTMLElement,
  text: string,
  cs: CSSStyleDeclaration
): number {
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.letterSpacing = cs.letterSpacing;
  probe.style.fontVariantNumeric = cs.fontVariantNumeric;
  // Critical for headers: CSS `uppercase` makes glyphs wider than raw label text
  probe.style.textTransform = cs.textTransform;
  probe.style.whiteSpace = "nowrap";

  let lineMax = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    probe.textContent = t;
    lineMax = Math.max(lineMax, probe.scrollWidth);
  }
  return lineMax;
}

/**
 * Measure ideal width for a column from currently rendered header/cells
 * (`data-column-id`). Uses an off-DOM probe so truncated headers still report
 * their full natural width (header label + drag/sort chrome + paddings).
 */
export function measureColumnAutosize(
  tableRoot: Element | null,
  columnId: string,
  pad = COLUMN_AUTOSIZE_PAD
): number {
  if (!tableRoot || typeof document === "undefined") {
    return columnMinWidth(columnId);
  }
  const nodes = tableRoot.querySelectorAll<HTMLElement>(
    `[data-column-id="${columnId}"]`
  );
  if (!nodes.length) return columnMinWidth(columnId);

  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;height:auto;width:auto;pointer-events:none;";
  document.body.appendChild(probe);

  let max = 0;
  try {
    nodes.forEach((el) => {
      const cs = getComputedStyle(el);
      const padX = horizontalPadding(cs);
      const isHeader = el.tagName === "TH";

      // Prefer selected option text for <select> cells
      const select = el.querySelector("select");
      if (select instanceof HTMLSelectElement) {
        const text = select.options[select.selectedIndex]?.text ?? select.value;
        if (!text) return;
        const selectCs = getComputedStyle(select);
        const w =
          measureTextWidth(probe, text, selectCs) +
          horizontalPadding(selectCs) +
          AUTOSIZE_SELECT_CHROME +
          padX;
        max = Math.max(max, w);
        return;
      }

      if (isHeader) {
        // Measure full *label* text (ignore visual truncate). Apply thead
        // typography (uppercase + tracking) so "TYPE DE COMPTE" is not
        // under-measured as "Type de compte".
        const labelEl =
          el.querySelector<HTMLElement>("[data-column-label]") ||
          el.querySelector<HTMLElement>(".truncate") ||
          el;
        let text = (labelEl.innerText || labelEl.textContent || "")
          .replace(/[↑↓]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) {
          text = HOLDINGS_COLUMN_META.find((c) => c.id === columnId)?.label ?? "";
        }
        if (!text) return;
        // th styles drive uppercase / letter-spacing used in the UI
        const titleW = measureTextWidth(probe, text, cs);
        max = Math.max(max, titleW + AUTOSIZE_HEADER_CHROME + padX);
        return;
      }

      // Body cells
      const text = (el.innerText || el.textContent || "")
        .replace(/\s+\n/g, "\n")
        .trim();
      if (!text && !el.querySelector("img, [data-logo]")) return;

      let lineMax = text ? measureTextWidth(probe, text, cs) : 0;
      if (el.querySelector("img, [data-logo]")) {
        lineMax += AUTOSIZE_LOGO_EXTRA;
      }
      max = Math.max(max, lineMax + padX);
    });
  } finally {
    document.body.removeChild(probe);
  }

  if (max <= 0) max = columnMinWidth(columnId);
  // Safety margin (default 24px) so headers never clip after autosize
  return Math.min(
    COLUMN_RESIZE_MAX,
    Math.max(COLUMN_RESIZE_MIN, Math.ceil(max + pad))
  );
}

/**
 * French-aware asset name sort: ignores case, accents and punctuation
 * so "L'Oréal" sorts with L (before LVMH), not after due to apostrophe.
 */
export function compareAssetNames(a: string, b: string): number {
  return a.localeCompare(b, "fr", {
    sensitivity: "base",
    ignorePunctuation: true,
  });
}
