import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "info" | "muted" | "risk" | "dark";

const TONES: Record<Tone, string> = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  muted: "bg-stone-100 text-stone-600 ring-stone-200",
  risk: "bg-red-50 text-red-800 ring-red-200",
  dark: "bg-stone-900 text-white ring-stone-900",
};

export function Badge({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-white p-4 ${className}`}>{children}</div>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
      {children}
    </p>
  );
}

export function SectionTitle({
  step,
  title,
  subtitle,
}: {
  step: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="border-t border-stone-200 pt-8">
      <Kicker>{step}</Kicker>
      <h2 className="mt-1 text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-stone-600">{subtitle}</p>
    </header>
  );
}

export function ScoreBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-stone-600">{label}</span>
        <span className="tabular-nums text-stone-400">
          {value.toFixed(1).replace(".0", "")} / {max}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-stone-800" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SourceLink({ url, label }: { url: string; label?: string }) {
  const short = label ?? new URL(url).hostname.replace(/^www\./, "");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[11px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
    >
      {short}
    </a>
  );
}
