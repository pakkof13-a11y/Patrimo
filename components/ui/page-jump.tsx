"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Aller à page : …" — shown when pageCount > 3.
 * User can pick from a select or type a number.
 */
export function PageJump({
  pageIndex,
  pageCount,
  onGoToPage,
}: {
  /** 0-based */
  pageIndex: number;
  pageCount: number;
  onGoToPage: (zeroBasedIndex: number) => void;
}) {
  const [draft, setDraft] = useState(String(pageIndex + 1));
  const [prevPageIndex, setPrevPageIndex] = useState(pageIndex);

  // Sync draft when pageIndex change (adjust state while rendering)
  if (pageIndex !== prevPageIndex) {
    setPrevPageIndex(pageIndex);
    setDraft(String(pageIndex + 1));
  }

  if (pageCount <= 3) return null;

  function commit(raw: string) {
    const n = Math.floor(Number(String(raw).replace(",", ".")));
    if (!Number.isFinite(n)) {
      setDraft(String(pageIndex + 1));
      return;
    }
    const clamped = Math.min(pageCount, Math.max(1, n));
    setDraft(String(clamped));
    onGoToPage(clamped - 1);
  }

  return (
    <div
      className="inline-flex flex-wrap items-center gap-1.5"
      data-testid="page-jump"
    >
      <span className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
        Aller à page&nbsp;:
      </span>
      <select
        className="input !w-auto !min-w-[3.25rem] !py-1 text-xs font-semibold tabular-nums"
        value={pageIndex + 1}
        onChange={(e) => commit(e.target.value)}
        aria-label="Sélectionner une page"
        data-testid="page-jump-select"
      >
        {Array.from({ length: pageCount }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={pageCount}
        inputMode="numeric"
        className="input !w-14 !py-1 text-center text-xs font-semibold tabular-nums"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Numéro de page"
        data-testid="page-jump-input"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="!px-2 !py-1 text-xs"
        onClick={() => commit(draft)}
        data-testid="page-jump-go"
      >
        OK
      </Button>
    </div>
  );
}
