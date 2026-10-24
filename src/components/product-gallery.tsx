"use client";

import { useMemo, useState } from "react";

export interface GalleryImage {
  url: string;
  variantValueId?: string;
  kind?: "produit" | "technique";
}

export interface GalleryColour {
  valueId: string;
  name: string;
  image?: string;
}

/**
 * La galerie — le bénéfice principal de l'étape 1.
 *
 * Une seule rangée de pastilles fait deux choses : elle dit **ce que le
 * commerçant vend**, et elle filtre **ses photos**. Les images techniques
 * (tableaux de mesures, schémas) ne dépendent d'aucun coloris : elles restent
 * toujours affichées, car c'est d'elles que viennent les dimensions.
 */
export function ProductGallery({
  images,
  colours,
}: {
  images: GalleryImage[];
  colours: GalleryColour[];
}) {
  const [selected, setSelected] = useState<string[]>(colours.map((colour) => colour.valueId));
  const [open, setOpen] = useState<number | null>(null);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const image of images) {
      if (image.kind === "technique" || !image.variantValueId) {
        map.technique = (map.technique ?? 0) + 1;
      } else {
        map[image.variantValueId] = (map[image.variantValueId] ?? 0) + 1;
      }
    }
    return map;
  }, [images]);

  const visible = useMemo(
    () =>
      images.filter(
        (image) =>
          image.kind === "technique" ||
          !image.variantValueId ||
          selected.includes(image.variantValueId),
      ),
    [images, selected],
  );

  function toggle(valueId: string) {
    setSelected((prev) =>
      prev.includes(valueId) ? prev.filter((id) => id !== valueId) : [...prev, valueId],
    );
  }

  return (
    <section>
      {/* Coloris = ce que je vends ET ce que je vois */}
      <div className="flex flex-wrap items-center gap-2">
        {colours.map((colour) => {
          const active = selected.includes(colour.valueId);
          return (
            <button
              key={colour.valueId}
              type="button"
              onClick={() => toggle(colour.valueId)}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition ${
                active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 text-stone-500"
              }`}
            >
              {colour.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={colour.image}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-5 w-5 rounded-full object-cover"
                />
              )}
              {colour.name.replace(/^\d+\s*/, "")}
              <span className={active ? "text-white/60" : "text-stone-400"}>
                {counts[colour.valueId] ?? 0}
              </span>
            </button>
          );
        })}

        <span className="rounded-full border border-dashed border-stone-300 px-2 py-1 text-[11px] text-stone-400">
          techniques {counts.technique ?? 0}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-stone-500">
        {visible.length} photo{visible.length > 1 ? "s" : ""} · les images techniques (mesures,
        schémas) restent toujours affichées
      </p>

      {/* La galerie */}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {visible.map((image, index) => {
          const colour = colours.find((c) => c.valueId === image.variantValueId);
          const technical = image.kind === "technique" || !image.variantValueId;

          return (
            <button
              key={image.url}
              type="button"
              onClick={() => setOpen(index)}
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
                className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                  technical ? "bg-white/90 text-stone-500" : "bg-stone-900/85 text-white"
                }`}
              >
                {technical ? "⬚ technique" : colour?.name.replace(/^\d+\s*/, "")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Plein écran */}
      {open !== null && visible[open] && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95 p-4"
          onClick={() => setOpen(null)}
          role="presentation"
        >
          <div className="flex items-center justify-between text-xs text-white/70">
            <span>
              {(open + 1).toString()} / {visible.length}
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
            className="mx-auto mt-4 max-h-[80vh] w-auto rounded-xl object-contain"
          />
          <div className="mt-auto flex justify-between gap-3 pt-4">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen((open - 1 + visible.length) % visible.length);
              }}
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm text-white"
            >
              ← Précédente
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen((open + 1) % visible.length);
              }}
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm text-white"
            >
              Suivante →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
