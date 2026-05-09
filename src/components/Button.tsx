"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline" | "danger" | "warn" | "safe";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-black font-semibold hover:brightness-110 active:brightness-95 disabled:opacity-50",
  ghost:
    "bg-transparent text-[var(--fg)] hover:bg-[var(--bg-elev-2)] disabled:opacity-50",
  outline:
    "border border-[var(--border-strong)] bg-[var(--bg-elev)] hover:bg-[var(--bg-elev-2)] disabled:opacity-50",
  danger:
    "bg-[var(--danger)] text-white font-semibold hover:brightness-110 active:brightness-95 disabled:opacity-50",
  warn:
    "bg-[var(--warn)] text-black font-semibold hover:brightness-110 active:brightness-95 disabled:opacity-50",
  safe:
    "border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-md",
  md: "h-10 px-4 text-sm rounded-lg",
  lg: "h-12 px-6 text-base rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "primary", size = "md", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-all whitespace-nowrap",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        "disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    />
  );
});
