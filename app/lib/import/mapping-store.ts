/**
 * Persistance locale des mappings CSV personnalisés (fingerprint headers → columnMap).
 * Côté client (localStorage). SSR-safe.
 */

import type { ColumnMapping } from "./types";
import { headersFingerprint } from "./dynamic-mapper";

const STORAGE_KEY = "patrimo.import.columnMaps.v1";

type StoreShape = Record<
  string,
  {
    columnMap: ColumnMapping;
    label?: string;
    updatedAt: string;
  }
>;

function readStore(): StoreShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoreShape;
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode
  }
}

export function loadSavedColumnMap(headers: string[]): ColumnMapping | null {
  const fp = headersFingerprint(headers);
  const entry = readStore()[fp];
  return entry?.columnMap ?? null;
}

export function saveColumnMap(
  headers: string[],
  columnMap: ColumnMapping,
  label?: string
): void {
  const fp = headersFingerprint(headers);
  const store = readStore();
  store[fp] = {
    columnMap,
    label,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

export function clearSavedColumnMap(headers: string[]): void {
  const fp = headersFingerprint(headers);
  const store = readStore();
  delete store[fp];
  writeStore(store);
}

export function listSavedMappings(): Array<{
  fingerprint: string;
  label?: string;
  updatedAt: string;
}> {
  return Object.entries(readStore()).map(([fingerprint, v]) => ({
    fingerprint,
    label: v.label,
    updatedAt: v.updatedAt,
  }));
}
