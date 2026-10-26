"use client";

import { useEffect } from "react";

/**
 * Filet de sécurité global. Message en français, action réelle (réessayer),
 * et jamais de trace technique à l'écran.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // La trace reste côté serveur (logs) ; l'utilisateur voit une phrase lisible.
    console.error("[app] erreur de rendu", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-10">
      <h1 className="text-xl font-semibold">Quelque chose s&apos;est mal passé</h1>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        Aucun crédit n&apos;a été débité pour cette page. Tu peux réessayer ;
        si le problème persiste, reviens dans quelques minutes.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 w-full rounded-2xl bg-stone-900 px-5 py-4 text-[15px] font-medium text-white"
      >
        Réessayer
      </button>
    </main>
  );
}
