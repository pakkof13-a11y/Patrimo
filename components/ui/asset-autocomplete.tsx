"use client";

import { useEffect, useRef, useState } from "react";
import { PlatformLogo } from "./platform-logo";
import { cn } from "@/app/lib/utils";

export type AssetSuggestion = {
  id?: string;
  name: string;
  ticker: string | null;
  assetClass: string;
  currency: string;
  priceProvider: string;
  providerSymbol?: string | null;
  logoUrl?: string | null;
  source: "local" | "catalog" | "coingecko";
  platformId?: string;
  platformName?: string;
};

type Props = {
  platformId: string;
  valueId: string;
  valueLabel?: string;
  onSelect: (hit: AssetSuggestion & { id: string }) => void;
  className?: string;
};

async function ensureAsset(
  hit: AssetSuggestion,
  platformId: string
): Promise<AssetSuggestion & { id: string }> {
  if (hit.id) return hit as AssetSuggestion & { id: string };

  // Prefer an already-owned local match by ticker before creating a duplicate
  if (hit.ticker) {
    try {
      const searchRes = await fetch(
        `/api/assets/search?q=${encodeURIComponent(hit.ticker)}&_=${Date.now()}`,
        { cache: "no-store" }
      );
      const searchData = await searchRes.json();
      const local = (searchData.results || []).find(
        (r: AssetSuggestion) =>
          r.source === "local" &&
          r.id &&
          (r.ticker || "").toUpperCase() === (hit.ticker || "").toUpperCase()
      );
      if (local?.id) {
        return {
          ...hit,
          id: local.id,
          name: local.name,
          ticker: local.ticker,
          platformId: local.platformId,
        };
      }
    } catch {
      /* continue to create */
    }
  }

  const res = await fetch("/api/assets", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: hit.name,
      ticker: hit.ticker || "",
      assetClass: hit.assetClass,
      platformId,
      currency: hit.currency || "EUR",
      priceProvider: hit.priceProvider || "YAHOO",
      providerSymbol: hit.providerSymbol || hit.ticker || "",
      logoUrl: hit.logoUrl || undefined,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" && data.error
        ? data.error
        : "Création d'actif impossible"
    );
  }
  return {
    ...hit,
    id: data.asset.id as string,
    name: data.asset.name,
    ticker: data.asset.ticker,
  };
}

export function AssetAutocomplete({
  platformId,
  valueId,
  valueLabel,
  onSelect,
  className,
}: Props) {
  const [query, setQuery] = useState(valueLabel || "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hits, setHits] = useState<AssetSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prevValueKey, setPrevValueKey] = useState(`${valueId}:${valueLabel}`);
  const valueKey = `${valueId}:${valueLabel}`;
  if (valueKey !== prevValueKey) {
    setPrevValueKey(valueKey);
    if (valueLabel) setQuery(valueLabel);
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function search(q: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/assets/search?q=${encodeURIComponent(q)}&_=${Date.now()}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string" && data.error
              ? data.error
              : "Recherche échouée"
          );
        }
        // Local (already owned) first — critical so extra buys hit the same asset id
        const results = (data.results || []) as AssetSuggestion[];
        results.sort((a, b) => {
          if (a.source === "local" && b.source !== "local") return -1;
          if (b.source === "local" && a.source !== "local") return 1;
          return 0;
        });
        setHits(results);
        setOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur recherche");
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 220);
  }

  async function pick(hit: AssetSuggestion) {
    if (!platformId) {
      setError("Choisissez d'abord une plateforme");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const ensured = await ensureAsset(hit, platformId);
      setQuery(
        `${ensured.name}${ensured.ticker ? ` (${ensured.ticker})` : ""}`
      );
      setOpen(false);
      onSelect(ensured);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sélection impossible");
    } finally {
      setCreating(false);
    }
  }

  async function createCustom() {
    const name = query.trim();
    if (!name || !platformId) {
      setError("Nom et plateforme requis pour créer un actif");
      return;
    }
    // Parse "NAME (TICKER)" optional
    const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const hit: AssetSuggestion = {
      name: m ? m[1].trim() : name,
      ticker: m ? m[2].trim().toUpperCase() : null,
      assetClass: "AUTRE",
      currency: "EUR",
      priceProvider: "MANUAL",
      source: "catalog",
    };
    await pick(hit);
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <input
        className="input"
        data-testid="tx-asset"
        placeholder="Rechercher un actif (LVMH, AAPL, Bitcoin…)"
        value={query}
        disabled={creating}
        onChange={(e) => {
          setQuery(e.target.value);
          search(e.target.value);
        }}
        onFocus={() => {
          search(query);
          setOpen(true);
        }}
        autoComplete="off"
      />
      {loading && (
        <div className="absolute right-2 top-2 text-[10px] text-slate-400">…</div>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
          {hits.length === 0 && !loading && (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40"
              onClick={() => createCustom()}
            >
              Créer « {query || "nouvel actif"} »…
            </button>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.source}-${h.ticker}-${h.name}-${i}`}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40"
              onClick={() => pick(h)}
            >
              <PlatformLogo src={h.logoUrl} name={h.name} size={22} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {h.name}
                  {h.ticker ? (
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      {h.ticker}
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">
                  {h.assetClass}
                  {h.source === "local" && h.platformName
                    ? ` · ${h.platformName}`
                    : ` · ${h.source}`}
                  {h.id ? " · en portefeuille" : ""}
                </div>
              </div>
            </button>
          ))}
          {query.trim().length >= 2 && (
            <button
              type="button"
              className="block w-full border-t border-[var(--border)] px-3 py-2 text-left text-xs text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40"
              onClick={() => createCustom()}
            >
              + Créer un nouvel actif « {query.trim()} »
            </button>
          )}
        </div>
      )}
    </div>
  );
}
