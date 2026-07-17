import * as React from "react";
import { cn } from "@/app/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

/**
 * Boutons Patrimo — sobriété finance.
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
        "rounded-[var(--radius-md)] transition-[background-color,border-color,color,opacity,box-shadow] duration-150",
        "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
        "motion-reduce:transition-none",
        variant === "default" &&
          "bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-110 active:brightness-95",
        variant === "outline" &&
          "border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--border-strong)] hover:bg-[var(--muted)]/60 active:bg-[var(--muted)]",
        variant === "ghost" &&
          "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:bg-[var(--muted)]",
        variant === "danger" &&
          "bg-[var(--danger)] text-white hover:brightness-110 active:brightness-95",
        size === "sm" && "h-8 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-10 px-4 text-sm",
        className
      )}
      {...props}
    />
  );
});
