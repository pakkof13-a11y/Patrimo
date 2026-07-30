import * as React from "react";
import { cn } from "@/app/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** default = teal (formulaires) · gold = CTA prestige (ajouter, importer…) */
  variant?: "default" | "outline" | "ghost" | "danger" | "gold";
  size?: "sm" | "md" | "lg";
};

/**
 * Boutons Aurea — sobriété finance.
 * Focus ring via --focus-ring ; pas d’ombre gratuite.
 */
export const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  {
    className,
    variant = "default",
    size = "md",
    type = "button",
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium",
        "rounded-[var(--radius-md)] transition-[background-color,border-color,color,opacity,box-shadow]",
        "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
        "motion-reduce:transition-none",
        variant === "default" &&
          "bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-110 active:brightness-95",
        variant === "outline" &&
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
        variant === "ghost" &&
          "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
        variant === "danger" &&
          "bg-[var(--negative)] text-[var(--surface)] hover:brightness-110 active:brightness-95",
        // `gold` reste distinct de `default` par sa bordure lumineuse : sur un
        // fond noir, un aplat doré sans liseré se lit comme un bloc plat.
        variant === "gold" &&
          "bg-[var(--gold-2)] text-[var(--primary-foreground)] hover:bg-[var(--gold-1)] active:bg-[var(--gold-3)] shadow-[0_0_0_1px_var(--gold-border)]",
        size === "sm" && "h-[1.75rem] px-[var(--space-2)] text-[length:var(--text-xs)]",
        size === "md" && "h-[2rem] px-[var(--space-3)] text-[length:var(--text-sm)]",
        size === "lg" && "h-[2.25rem] px-[var(--space-4)] text-[length:var(--text-base)]",
        className
      )}
      {...props}
    />
  );
});
