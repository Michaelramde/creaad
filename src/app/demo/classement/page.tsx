import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { productRecords } from "@/lib/db/schema";
import type { PoolImage, VariantAxis } from "@/lib/products/types";

export const dynamic = "force-dynamic";

const DEMO_PRODUCT = "1005001843831532";

const LABEL: Record<string, { text: string; className: string }> = {
  packshot: { text: "packshot", className: "bg-emerald-600" },
  scene: { text: "scène", className: "bg-sky-600" },
  spec: { text: "produit + mesures", className: "bg-violet-600" },
  sans_produit: { text: "sans produit", className: "bg-stone-600" },
};

/**
 * Planche d'audit — sert à **juger** le modèle vision, pas à être montrée au
 * commerçant. Chaque vignette porte la décision du modèle, pour vérifier à
 * l'œil si elle tient.
 */
export default async function AuditPage() {
  const [record] = await db
    .select()
    .from(productRecords)
    .where(eq(productRecords.productId, DEMO_PRODUCT))
    .limit(1);

  if (!record) return <main className="p-6 text-sm">Produit absent.</main>;

  const images = record.images as PoolImage[];
  const axes = record.variantAxes as VariantAxis[];
  const colours = axes.flatMap((axis) =>
    axis.values.map((value) => ({ valueId: value.valueId, name: value.name.replace(/^\d+\s*/, "") })),
  );

  return (
    <main className="mx-auto max-w-3xl px-3 py-6">
      <h1 className="text-base font-semibold">Audit du classement vision · {images.length} images</h1>
      <p className="mt-1 text-[11px] text-stone-500">
        vert = packshot · bleu = scène · violet = produit + mesures · gris = sans produit
      </p>

      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {images.map((image, index) => {
          const style = LABEL[image.kind ?? "sans_produit"] ?? LABEL.sans_produit!;
          const colour = colours.find((c) => c.valueId === image.variantValueId)?.name;
          return (
            <figure key={image.url} className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="aspect-square w-full object-cover"
                />
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] text-white">
                  {index + 1}
                </span>
              </div>
              <figcaption className={`${style.className} px-1 py-0.5 text-[9px] text-white`}>
                {style.text}
                {colour ? ` · ${colour}` : ""}
                {image.technicalText ? " · texte" : ""}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </main>
  );
}
