"use client";

import { forwardRef } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/app/lib/utils";

export type DateInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  /** Affiche l’icône calendrier (défaut true) */
  showIcon?: boolean;
};

/**
 * Saisie de date harmonisée (type=date native, chrome UI unifié).
 * Utiliser pour éviter les rendus bruts hétérogènes selon le navigateur.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput(
    { className, showIcon = true, ...props },
    ref
  ) {
    return (
      <div className="relative min-w-0">
        {showIcon ? (
          <Calendar
            className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
        ) : null}
        <input
          ref={ref}
          type="date"
          className={cn(
            "input w-full font-normal tabular-nums",
            "[color-scheme:light] dark:[color-scheme:dark]",
            showIcon && "!pl-9",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);

/**
 * Label + DateInput + aide (raccourci formulaires).
 */
export function DateField({
  label,
  hint,
  optional,
  error,
  className,
  ...inputProps
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  className?: string;
} & DateInputProps) {
  return (
    <label
      className={cn(
        "block min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300",
        className
      )}
    >
      <span className="mb-1 flex flex-wrap items-baseline gap-1.5">
        <span>{label}</span>
        {optional ? (
          <span className="font-normal text-slate-400">optionnel</span>
        ) : null}
      </span>
      <DateInput aria-invalid={error ? true : undefined} {...inputProps} />
      {error ? (
        <span role="alert" className="mt-1 block text-[11px] text-red-600">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[10px] font-normal leading-snug text-slate-400">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
