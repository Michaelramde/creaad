"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ConfirmArticle({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/confirm-article`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Le déblocage a échoué.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={busy}
        className="w-full rounded-2xl bg-stone-900 px-5 py-3.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "…" : "C'est bien ce produit"}
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
        Cette confirmation est enregistrée. Elle ne modifie pas le score — l&apos;article
        n&apos;a pas été identifié automatiquement, c&apos;est toi qui l&apos;affirmes.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
