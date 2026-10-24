"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BUILD_STAGES, ProgressScreen } from "@/components/progress-screen";
import type { VariantAxis } from "@/lib/products/types";

/**
 * Choix des coloris par vignettes.
 *
 * Le commerçant peut en vendre plusieurs : la sélection est donc multiple.
 * On montre l'image, jamais le stock — savoir qu'il reste 94 pièces chez le
 * fournisseur ne l'aide pas à décider ce qu'il vend.
 *
 * Un coloris épuisé reste visible mais non sélectionnable : on ne cache pas
 * ce qui existe, on empêche juste de le vendre par erreur.
 */
export function VariantPicker({
  analysisId,
  axes,
  creditXof,
}: {
  analysisId: string;
  axes: VariantAxis[];
  creditXof: number;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<Record<string, string[]>>(() => {
    // Un seul choix possible sur un axe → présélection, pour ne pas faire cliquer.
    const initial: Record<string, string[]> = {};
    for (const axis of axes) {
      const available = axis.values.filter((value) => value.available);
      if (available.length === 1 && available[0]) initial[axis.axis] = [available[0].valueId];
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = axes.every((axis) => {
    const selectable = axis.values.filter((value) => value.available);
    if (selectable.length === 0) return true;
    return (selection[axis.axis] ?? []).length > 0;
  });

  function toggle(axis: string, valueId: string) {
    setSelection((prev) => {
      const current = prev[axis] ?? [];
      const next = current.includes(valueId)
        ? current.filter((id) => id !== valueId)
        : [...current, valueId];
      return { ...prev, [axis]: next };
    });
  }

  async function submit() {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);

    // La construction prend plusieurs dizaines de secondes : on affiche les
    // étapes réelles plutôt qu'un bouton grisé sans explication.
    try {
      const res = await fetch(`/api/analyses/${analysisId}/variante`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Le choix n'a pas pu être enregistré.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <ProgressScreen
        title="Construction des kits"
        stages={BUILD_STAGES}
        note="La planche est bâtie à partir de la galerie du coloris choisi, puis le marché du produit est interrogé. Les créas arrivent juste après — tu peux rester sur cette page."
      />
    );
  }

  return (
    <section className="mt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
        Quels coloris vends-tu ?
      </p>
      <p className="mt-1 text-xs text-stone-500">
        Sélectionne-en un ou plusieurs — la planche partira du premier choisi.
      </p>

      {axes.map((axis) => (
        <div key={axis.axis} className="mt-3">
          <p className="text-sm font-medium text-stone-700">{axis.axis}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {axis.values.map((value) => {
              const selected = (selection[axis.axis] ?? []).includes(value.valueId);
              return (
                <button
                  key={value.valueId}
                  type="button"
                  disabled={!value.available}
                  onClick={() => toggle(axis.axis, value.valueId)}
                  className={`overflow-hidden rounded-xl border text-left transition ${
                    selected ? "border-stone-900 ring-2 ring-stone-900" : "border-stone-200"
                  } ${value.available ? "bg-white" : "opacity-45"}`}
                >
                  {value.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={value.image}
                      alt={value.name}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-stone-100 text-[10px] text-stone-400">
                      sans image
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                    <p className="truncate text-[11px] font-medium">{value.name}</p>
                    {selected && <span className="text-[11px]">✓</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!complete}
        className="mt-5 w-full rounded-2xl bg-stone-900 px-5 py-4 text-[15px] font-medium text-white disabled:opacity-40"
      >
        Construire mes kits
      </button>

      <p className="mt-3 text-center text-[11px] text-stone-400">
        {creditXof} FCFA seront débités à la livraison des kits.
      </p>
    </section>
  );
}
