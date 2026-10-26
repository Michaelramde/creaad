"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Progression **réelle** d'une analyse.
 *
 * Avant : six étapes inventées côté client (`at: 5, 13, 20…`) qui défilaient
 * au rythme d'un minuteur, sans aucun rapport avec le pipeline. Ici, l'étape
 * affichée est le statut écrit en base par le serveur, et la page se
 * rafraîchit d'elle-même tant que l'analyse est en vol.
 */
const STEPS: { status: string; label: string }[] = [
  { status: "ocr", label: "Lecture des photos, recherche du produit" },
  { status: "appariement", label: "Comparaison des annonces, planche et marché" },
];

const IN_FLIGHT = new Set(["ocr", "appariement"]);

export function RunProgress({ status, startedAt }: { status: string; startedAt: string }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const active = IN_FLIGHT.has(status);

  useEffect(() => {
    if (!active) return;
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [active, router]);

  if (!active) return null;

  const current = Math.max(0, STEPS.findIndex((step) => step.status === status));

  return (
    <section
      aria-live="polite"
      className="mt-4 rounded-2xl border border-stone-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Analyse en cours</p>
        <p className="text-xs tabular-nums text-stone-500">{elapsed} s</p>
      </div>

      <ol className="mt-3 space-y-2">
        {STEPS.map((step, index) => {
          const done = index < current;
          const isActive = index === current;
          return (
            <li key={step.status} className="flex items-center gap-2">
              <span
                className={
                  done
                    ? "flex h-4 w-4 items-center justify-center rounded-full bg-stone-900 text-[9px] text-white"
                    : isActive
                      ? "h-4 w-4 rounded-full border-2 border-stone-900"
                      : "h-4 w-4 rounded-full border border-stone-300"
                }
              >
                {done ? "✓" : ""}
              </span>
              <span
                className={
                  done
                    ? "text-xs text-stone-400 line-through"
                    : isActive
                      ? "text-xs font-medium"
                      : "text-xs text-stone-400"
                }
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] leading-relaxed text-stone-500">
        La page se met à jour toute seule. Aucun crédit n&apos;est débité si le produit
        n&apos;est pas reconnu.
      </p>
    </section>
  );
}
