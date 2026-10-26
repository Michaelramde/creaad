"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * « Ce n'est pas mon produit. »
 *
 * Le pire échec du produit n'était pas le blocage : c'était le faux positif —
 * une planche construite sur l'article de quelqu'un d'autre, facturée, sans
 * recours. Ce bouton rend le recours possible en un clic, et produit au
 * passage une étiquette gratuite pour recalibrer le seuil d'appariement.
 */
export function WrongProductButton({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function report() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/wrong-product`, { method: "POST" });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Le signalement a échoué.");
      setDone(data.message ?? "Signalement enregistré.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p aria-live="polite" className="mt-2 text-[11px] leading-relaxed text-emerald-800">
        {done}
      </p>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void report()}
        disabled={busy}
        className="text-[11px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-800 disabled:opacity-50"
      >
        {busy ? "Signalement…" : "Ce n'est pas mon produit — me rembourser"}
      </button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
