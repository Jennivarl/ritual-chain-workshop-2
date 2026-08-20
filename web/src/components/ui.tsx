"use client";

import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  children,
  action,
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-5">
      {title && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-white uppercase">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>
            )}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "default",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "yes" | "no" | "ghost";
  type?: "button" | "submit";
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: "bg-white text-black hover:bg-neutral-200",
    yes: "bg-[var(--color-yes)] text-white hover:brightness-110",
    no: "bg-[var(--color-no)] text-white hover:brightness-110",
    ghost:
      "border border-[var(--color-edge)] text-white hover:border-neutral-500 bg-transparent",
  };

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--color-muted)]">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-[var(--color-edge)] bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-lg border border-[var(--color-edge)] bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
    />
  );
}

const badgeTones: Record<string, string> = {
  Open: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Closed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Resolving: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Resolved: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Invalid: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  YES: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  NO: "bg-red-500/15 text-red-300 border-red-500/30",
};

export function Badge({ label }: { label: string }) {
  const tone = badgeTones[label] ?? "bg-neutral-500/15 text-neutral-300 border-neutral-500/30";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className="tnum mt-0.5 text-sm text-white">{value}</div>
    </div>
  );
}

/** Inline transaction feedback: one line, never a stack trace. */
export function TxStatus({
  error,
  isPending,
  isMining,
  isSuccess,
  hash,
  explorer,
}: {
  error?: string;
  isPending?: boolean;
  isMining?: boolean;
  isSuccess?: boolean;
  hash?: string;
  explorer?: (hash: string) => string;
}) {
  if (error) return <p className="mt-2 text-xs text-red-400">{error}</p>;
  if (isPending) return <p className="mt-2 text-xs text-[var(--color-muted)]">Confirm in your wallet…</p>;
  if (isMining) return <p className="mt-2 text-xs text-[var(--color-muted)]">Mining…</p>;
  if (isSuccess && hash) {
    return (
      <p className="mt-2 text-xs text-emerald-400">
        Confirmed.{" "}
        {explorer && (
          <a
            href={explorer(hash)}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            View
          </a>
        )}
      </p>
    );
  }
  return null;
}
