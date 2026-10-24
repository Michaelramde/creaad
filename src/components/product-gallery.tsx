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

const PREVIEW = 9;

/**
 * La galerie — le bénéfice principal de l'étape 1.
 *
 * Neuf vignettes à l'écran : le bénéfice se voit d'un coup d'œil. Le reste
 * s'ouvre en plein écran, avec les filtres par coloris, pour qui veut explorer.
 *
 * Une seule rangée de pastilles fait deux choses : elle dit **ce que le
 * commerçant vend** et elle filtre **ses photos**. Les images techniques
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
  const [expanded, setExpanded] = useState(false);
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

  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {colours.map((colour) => {
        const active = selected.includes(colour.valueId);
        return (
          <button
            key={colour.valueId}
            type="button"
            onClick={() => toggle(colour.valueId)}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition ${
              active
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-300 text-stone-500"
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
  );

  return (
    <section>
      {chips}

      <p className="mt-2 text-[11px] text-stone-500">
        {visible.length} photo{visible.length > 1 ? "s" : ""} · les images techniques (mesures,
        schémas) restent toujours affichées
      </p>

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

      {expanded && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-50">
          <div className="mx-auto max-w-md px-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Toutes les photos</p>
              <button type="button" onClick={() => setExpanded(false)} className="text-xs text-stone-500">
                Fermer ✕
              </button>
            </div>

            <div className="mt-3">{chips}</div>

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
    </section>
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
  const technical = image.kind === "technique" || !image.variantValueId;

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
        className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
          technical ? "bg-white/90 text-stone-500" : "bg-stone-900/85 text-white"
        }`}
      >
        {technical ? "⬚ technique" : colour?.name.replace(/^\d+\s*/, "")}
      </span>
    </button>
  );
}
