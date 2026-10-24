"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProgressScreen, type Stage } from "@/components/progress-screen";

/** Étapes de l'étude de marché — la seconde demande, facturée séparément. */
const MARKET_STAGES: Stage[] = [
  { at: 0, label: "Lecture du marché de ce type de produit" },
  { at: 4, label: "Recherche des annonces du produit" },
  { at: 14, label: "Élargissement aux pays voisins" },
  { at: 30, label: "Analyse des avis d'acheteurs" },
  { at: 45, label: "Désirs, objections et angles" },
];

/**
 * Seconde demande : l'étude de marché.
 *
 * Volontairement séparée du dossier produit — c'est une étape distincte, avec
 * son propre coût. L'utilisateur sait ce qu'il déclenche.
 */
export function MarketStepButton({
  analysisId,
  creditXof,
  disabled,
}: {
  analysisId: string;
  creditXof: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/analyses/${analysisId}/marche`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "L'étude de marché a échoué.");

      // La page se rafraîchit : le marché s'affiche, l'enrichissement suit.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <ProgressScreen
        title="Étude de marché"
        stages={MARKET_STAGES}
        note="Les annonces des concurrents sont cherchées pays par pays, puis élargies. Les avis d'acheteurs sont ensuite analysés pour en tirer les désirs et les objections."
      />
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
        Étape 2
      </p>
      <h2 className="mt-1 text-base font-semibold">Étudier le marché</h2>
      <p className="mt-1 text-xs leading-relaxed text-stone-600">
        Les annonces des concurrents, les désirs d&apos;acheteurs, les objections et les angles
        publicitaires — à partir des avis réels de ce produit.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => void launch()}
        disabled={disabled}
        className="mt-4 w-full rounded-2xl bg-stone-900 px-5 py-4 text-[15px] font-medium text-white disabled:opacity-40"
      >
        Lancer l&apos;étude — {creditXof} FCFA
      </button>
      <p className="mt-2 text-center text-[11px] text-stone-400">
        Débité une fois, quand le rapport est prêt.
      </p>
    </section>
  );
}
