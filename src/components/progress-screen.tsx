"use client";

import { useEffect, useState } from "react";

export interface Stage {
  at: number;
  label: string;
}

/** Étapes de l'analyse initiale (photos → produit → coloris). */
export const IDENTIFY_STAGES: Stage[] = [
  { at: 0, label: "Lecture des photos" },
  { at: 5, label: "Recherche du produit" },
  { at: 13, label: "Comparaison des annonces" },
  { at: 20, label: "Construction de la planche" },
  { at: 26, label: "Analyse du marché" },
  { at: 32, label: "Rédaction des créas" },
];

/** Étapes de la construction des kits, après le choix du coloris. */
export const BUILD_STAGES: Stage[] = [
  { at: 0, label: "Galerie du coloris choisi" },
  { at: 5, label: "Classement des vues du produit" },
  { at: 18, label: "Construction de la planche" },
  { at: 30, label: "Analyse du marché du produit" },
  { at: 45, label: "Rédaction des créas" },
];

/**
 * Écran de progression partagé.
 *
 * Il affiche le temps réellement écoulé et les étapes dans leur ordre
 * d'exécution — pas une barre de pourcentage inventée.
 */
export function ProgressScreen({
  title,
  stages,
  note,
  onTick,
}: {
  title: string;
  stages: Stage[];
  note?: string;
  onTick?: (elapsed: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(seconds);
      onTick?.(seconds);
    }, 500);
    return () => clearInterval(timer);
  }, [onTick]);

  const current = stages.reduce((acc, stage, index) => (elapsed >= stage.at ? index : acc), 0);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-16">
      <div className="flex items-center gap-3">
        <span className="relative flex h-9 w-9 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stone-900 opacity-20" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-stone-900" />
        </span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs tabular-nums text-stone-500">{elapsed} s</p>
        </div>
      </div>

      <ol className="mt-8 space-y-3">
        {stages.map((stage, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={stage.label} className="flex items-center gap-3">
              <span
                className={
                  done
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-stone-900 text-[10px] text-white"
                    : active
                      ? "flex h-5 w-5 items-center justify-center rounded-full border-2 border-stone-900"
                      : "flex h-5 w-5 items-center justify-center rounded-full border border-stone-300"
                }
              >
                {done ? "✓" : ""}
              </span>
              <span
                className={
                  done
                    ? "text-sm text-stone-400 line-through"
                    : active
                      ? "text-sm font-medium text-stone-900"
                      : "text-sm text-stone-400"
                }
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      {note && <p className="mt-8 text-xs leading-relaxed text-stone-400">{note}</p>}
    </main>
  );
}
