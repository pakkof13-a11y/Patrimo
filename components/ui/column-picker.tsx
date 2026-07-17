"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";

export type ColumnPickerItem = {
  id: string;
  label: string;
  /** Locked = mandatory: always checked, disabled checkbox */
  locked?: boolean;
  /** "mandatory" | "optional" (or legacy group keys) */
  group?: string;
};

function reorderIds(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order;
  const next = [...order];
  const fromIdx = next.indexOf(fromId);
  const toIdx = next.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0) return order;
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, fromId);
  return next;
}

function isMandatoryItem(c: ColumnPickerItem): boolean {
  return Boolean(c.locked) || c.group === "mandatory";
}

type MenuCoords = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function ColumnPicker({
  columns,
  visibility,
  onChange,
  order,
  onOrderChange,
  onReset,
  testId = "column-picker",
}: {
  columns: ColumnPickerItem[];
  visibility: Record<string, boolean>;
  onChange: (id: string, visible: boolean) => void;
  /** Ordered column ids — list is displayed in this order when provided */
  order?: string[];
  onOrderChange?: (order: string[]) => void;
  onReset?: () => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setCoords(null);
      return;
    }
    function update() {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const menuWidth = 320;
      const gap = 8;
      const pad = 12;
      const spaceBelow = window.innerHeight - r.bottom - pad;
      const spaceAbove = r.top - pad;
      const preferBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(520, Math.max(240, preferBelow ? spaceBelow : spaceAbove));
      let left = r.right - menuWidth;
      left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad));
      setCoords({
        top: preferBelow ? r.bottom + gap : Math.max(pad, r.top - gap - maxHeight),
        left,
        width: menuWidth,
        maxHeight,
      });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, columns.length]);

  const byId = new Map(columns.map((c) => [c.id, c]));
  const ordered: ColumnPickerItem[] = order?.length
    ? [
        ...(order.map((id) => byId.get(id)).filter(Boolean) as ColumnPickerItem[]),
        ...columns.filter((c) => !order.includes(c.id)),
      ]
    : columns;

  const mandatoryCols = ordered.filter(isMandatoryItem);
  const optionalCols = ordered.filter((c) => !isMandatoryItem(c));

  const visibleCount = ordered.filter((c) => {
    if (isMandatoryItem(c)) return true;
    return visibility[c.id] !== false;
  }).length;
  const canReorder = Boolean(onOrderChange && order);

  function handleDrop(targetId: string) {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    setDragOverId(null);
    if (!fromId || !onOrderChange || !order) return;
    onOrderChange(reorderIds(order, fromId, targetId));
  }

  function renderRow(c: ColumnPickerItem) {
    const mandatory = isMandatoryItem(c);
    const checked = mandatory || visibility[c.id] !== false;
    return (
      <li
        key={c.id}
        className={cn(
          "rounded-md transition-colors",
          dragOverId === c.id && "bg-teal-500/10 ring-1 ring-teal-500/40"
        )}
        onDragOver={(e) => {
          if (!canReorder) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOverId(c.id);
        }}
        onDragLeave={() => {
          if (dragOverId === c.id) setDragOverId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop(c.id);
        }}
      >
        <div
          className={cn(
            "flex items-start gap-1.5 rounded-md px-1.5 py-1.5 text-sm",
            mandatory
              ? "bg-[var(--muted)]/40 opacity-80"
              : "hover:bg-[var(--muted)]"
          )}
        >
          {canReorder && (
            <span
              draggable
              role="button"
              tabIndex={0}
              aria-label={`Déplacer ${c.label}`}
              title="Glisser pour réordonner"
              className={cn(
                "mt-0.5 cursor-grab touch-none rounded p-0.5 text-zinc-400 active:cursor-grabbing",
                !mandatory && "hover:text-zinc-600 dark:hover:text-zinc-200"
              )}
              data-testid={`column-drag-${c.id}`}
              onDragStart={(e) => {
                dragIdRef.current = c.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", c.id);
                e.stopPropagation();
              }}
              onDragEnd={() => {
                dragIdRef.current = null;
                setDragOverId(null);
              }}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
          <label
            className={cn(
              "flex min-w-0 flex-1 items-start gap-2",
              mandatory ? "cursor-not-allowed" : "cursor-pointer"
            )}
            title={c.label}
          >
            <input
              type="checkbox"
              className="mt-0.5 shrink-0 accent-teal-700 disabled:cursor-not-allowed"
              checked={checked}
              disabled={mandatory}
              readOnly={mandatory}
              aria-disabled={mandatory}
              onChange={(e) => {
                if (mandatory) return;
                onChange(c.id, e.target.checked);
              }}
            />
            <span className="min-w-0 flex-1 break-words leading-snug text-[13px]">
              {c.label}
            </span>
            {mandatory && (
              <span className="mt-0.5 shrink-0 rounded bg-zinc-200/80 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                Fixe
              </span>
            )}
          </label>
        </div>
      </li>
    );
  }

  const menu =
    open &&
    coords &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={menuRef}
        className="z-[100] rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl"
        data-testid="column-picker-menu"
        style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          width: coords.width,
          maxHeight: coords.maxHeight,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="mb-0.5 shrink-0 text-xs font-semibold tracking-tight text-[var(--foreground)]">
          Colonnes du tableau
        </div>
        <p className="mb-2.5 shrink-0 text-[11px] leading-snug text-[var(--muted-foreground)]">
          Obligatoires toujours visibles · optionnelles au choix · glisser pour
          l&apos;ordre
        </p>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5">
          <section data-testid="column-picker-mandatory">
            <h3 className="sticky top-0 z-10 mb-1.5 bg-[var(--card)] py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Obligatoires
              <span className="ml-1.5 tabular-nums font-normal opacity-70">
                ({mandatoryCols.length})
              </span>
            </h3>
            <ul className="space-y-0.5">{mandatoryCols.map(renderRow)}</ul>
          </section>
          <section data-testid="column-picker-optional">
            <h3 className="sticky top-0 z-10 mb-1.5 bg-[var(--card)] py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Optionnelles
              <span className="ml-1.5 tabular-nums font-normal opacity-70">
                ({optionalCols.length})
              </span>
            </h3>
            <ul className="space-y-0.5">{optionalCols.map(renderRow)}</ul>
          </section>
        </div>
        {onReset && (
          <button
            type="button"
            className="mt-2.5 shrink-0 w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-left text-xs font-medium text-teal-800 hover:bg-[var(--muted)] dark:text-teal-200"
            onClick={onReset}
            data-testid="column-picker-reset"
          >
            Réinitialiser colonnes et ordre
          </button>
        )}
      </div>,
      document.body
    );

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
        title="Afficher, masquer et réordonner les colonnes"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Columns3 className="h-3.5 w-3.5" />
        Colonnes
        <span className="ml-1 text-[10px] text-zinc-500">
          {visibleCount}/{columns.length}
        </span>
      </Button>
      {menu}
    </div>
  );
}

export { reorderIds };
