"use client";

import { useMemo, useState } from "react";

import type { ImageKind } from "@/lib/products/types";

export interface GalleryImage {
  url: string;
  kind?: ImageKind;
  variantValueId?: string;
}

export interface GalleryColour {
  valueId: string;
  name: string;
  image?: string;
}

const PREVIEW = 9;

const NATURE: Record<ImageKind, { label: string; badge: string }> = {
  packshot: { label: "Produit", badge: "bg-stone-900/85" },
  scene: { label: "En scène", badge: "bg-sky-700/85" },
  spec: { label: "Mesures", badge: "bg-violet-700/85" },
  marketing: { label: "Marketing", badge: "bg-amber-700/85" },
  sans_produit: { label: "Sans produit", badge: "bg-stone-500/85" },
};

type Tab = "tout" | "packshot" | "scene" | "spec" | "autre";

const TABS: { id: Tab; label: string }[] = [
  { id: "tout", label: "Tout" },
  { id: "packshot", label: "Produit seul" },
  { id: "scene", label: "En scène" },
  { id: "spec", label: "Mesures" },
  { id: "autre", label: "Sans produit" },
];

/**
 * La galerie — le benefice principal de l'etape 1.
 *
 * Deux gestes distincts, pour qu'ils se comprennent :
 *   1. « Quels coloris vends-tu ? » — une decision, enregistree, qui pilote
 *      la galerie ET le contenu de l'export.
 *   2. « Toutes les photos » — une consultation, par nature d'image.
 *
 * Les images sans coloris (mesures, marketing, sans produit) restent toujours
 * incluses : c'est d'elles que viennent les dimensions.
 */
export function ProductGallery({
  images,
  colours,
  initialSelected,
  analysisId,
  exportHref,
}: {
  images: GalleryImage[];
  colours: GalleryColour[];
  initialSelected?: string[];
  analysisId?: string;
  exportHref?: string;
}) {
  const [sold, setSold] = useState<string[]>(
    initialSelected ?? colours.map((colour) => colour.valueId),
  );
  const [tab, setTab] = useState<Tab>("tout");
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const image of images) {
      if (image.variantValueId) map[image.variantValueId] = (map[image.variantValueId] ?? 0) + 1;
    }
    return map;
  }, [images]);

  const kept = useMemo(
    () =>
      images.filter(
        (image) =>
          !image.variantValueId ||
          // Une image de mesures part toujours : elle porte les dimensions.
          image.kind === "spec" ||
          sold.includes(image.variantValueId),
      ),
    [images, sold],
  );

  const visible = useMemo(() => {
    if (tab === "tout") return kept;
    if (tab === "autre") return kept.filter((image) => image.kind === "sans_produit");
    return kept.filter((image) => image.kind === tab);
  }, [kept, tab]);

  const tabCount = (id: Tab) => {
    if (id === "tout") return kept.length;
    if (id === "autre") return kept.filter((image) => image.kind === "sans_produit").length;
    return kept.filter((image) => image.kind === id).length;
  };

  function toggle(valueId: string) {
    const next = sold.includes(valueId) ? sold.filter((id) => id !== valueId) : [...sold, valueId];
    setSold(next);

    if (analysisId) {
      setSaving(true);
      void fetch(`/api/analyses/${analysisId}/coloris`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected: next }),
      })
        .catch(() => undefined)
        .finally(() => setSaving(false));
    }
  }

  const selection = (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
        Quels coloris vends-tu ?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {colours.map((colour) => {
          const checked = sold.includes(colour.valueId);
          return (
            <button
              key={colour.valueId}
              type="button"
              onClick={() => toggle(colour.valueId)}
              aria-pressed={checked}
              className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 transition ${
                checked ? "border-stone-900 bg-stone-50" : "border-stone-200 opacity-70"
              }`}
            >
              {colour.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={colour.image}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-lg object-cover"
                />
              )}
              <span className="text-left">
                <span className="block text-[11px] font-medium leading-tight">
                  {colour.name.replace(/^\d+\s*/, "")}
                </span>
                <span className="block text-[10px] leading-tight text-stone-500">
                  {counts[colour.valueId] ?? 0} photo{(counts[colour.valueId] ?? 0) > 1 ? "s" : ""}
                </span>
              </span>
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-md border text-[9px] ${
                  checked ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300"
                }`}
              >
                {checked ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-stone-500">
        {saving
          ? "Enregistrement…"
          : "Les images de mesures et les visuels sans produit restent toujours inclus."}
      </p>
    </section>
  );

  const tabs = (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {TABS.map((entry) => {
        const count = tabCount(entry.id);
        if (count === 0) return null;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition ${
              tab === entry.id ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
            }`}
          >
            {entry.label} {count}
          </button>
        );
      })}
    </div>
  );

  const exporter = exportHref ? (
    <a
      href={`${exportHref}${sold.length < colours.length ? `?coloris=${sold.join(",")}` : ""}`}
      className="mt-2 flex w-full items-center justify-between rounded-xl border border-stone-300 px-3 py-2.5 text-xs font-medium text-stone-800"
    >
      <span>⤓ Exporter · {kept.length} photos + fiche</span>
      <span className="text-[10px] font-normal text-stone-500">ZIP</span>
    </a>
  ) : null;

  return (
    <div className="space-y-4">
      {selection}

      <section>
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
            Toutes les photos
          </p>
          <span className="text-[11px] text-stone-500">{visible.length}</span>
        </div>

        <div className="mt-2">{tabs}</div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {visible.slice(0, PREVIEW).map((image, index) => (
            <Tile
              key={image.url}
              image={image}
              colours={colours}
              onClick={() => {
                setExpanded(true);
                setOpen(index);
              }}
            />
          ))}
        </div>

        {visible.length > PREVIEW && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 w-full rounded-xl border border-stone-300 py-2.5 text-xs font-medium text-stone-700"
          >
            Voir les {visible.length} photos →
          </button>
        )}

        {exporter}
      </section>

      {expanded && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-50">
          <div className="mx-auto max-w-md px-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Toutes les photos</p>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-xs text-stone-500"
              >
                Fermer ✕
              </button>
            </div>

            <div className="mt-3">{selection}</div>
            <div className="mt-3">{tabs}</div>

            <div className="mt-3 grid grid-cols-3 gap-1.5 pb-10">
              {visible.map((image, index) => (
                <Tile
                  key={image.url}
                  image={image}
                  colours={colours}
                  onClick={() => setOpen(index)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {open !== null && visible[open] && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 p-4" role="presentation">
          <div className="flex items-center justify-between text-xs text-white/70">
            <span>
              {open + 1} / {visible.length}
            </span>
            <button type="button" onClick={() => setOpen(null)} className="text-white">
              Fermer ✕
            </button>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={visible[open]?.url}
            alt=""
            referrerPolicy="no-referrer"
            className="mx-auto mt-4 max-h-[76vh] w-auto rounded-xl object-contain"
          />

          <div className="mt-auto flex justify-between gap-3 pt-4">
            <button
              type="button"
              onClick={() => setOpen((open - 1 + visible.length) % visible.length)}
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm text-white"
            >
              ← Précédente
            </button>
            <button
              type="button"
              onClick={() => setOpen((open + 1) % visible.length)}
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm text-white"
            >
              Suivante →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  image,
  colours,
  onClick,
}: {
  image: GalleryImage;
  colours: GalleryColour[];
  onClick: () => void;
}) {
  const colour = colours.find((c) => c.valueId === image.variantValueId);
  const nature = NATURE[image.kind ?? "sans_produit"] ?? NATURE.sans_produit;

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative overflow-hidden rounded-xl border border-stone-200 bg-white"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        className="aspect-square w-full object-cover"
      />
      <span
        className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white ${nature.badge}`}
      >
        {colour ? colour.name.replace(/^\d+\s*/, "") : nature.label}
      </span>
    </button>
  );
}
