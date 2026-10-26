"use client";

import { useEffect, useState } from "react";

/**
 * Attente honnête.
 *
 * Remplace `ProgressScreen`, qui affichait des étapes inventées
 * (`at: 5, 13, 18, 30, 45`) sans aucun rapport avec ce que fait le serveur.
 * Ici : le temps réellement écoulé, une animation indéterminée, et une phrase
 * qui dit **ce qui se passe vraiment**. La progression détaillée vit sur la
 * page de résultat, qui lit l'état écrit en base.
 */
export function WaitingScreen({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <section aria-live="polite" aria-busy="true" className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
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

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-stone-800" />
      </div>

      {note && <p className="mt-3 text-[11px] leading-relaxed text-stone-500">{note}</p>}
    </section>
  );
}
