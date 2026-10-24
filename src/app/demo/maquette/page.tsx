import { eq } from "drizzle-orm";
import Link from "next/link";

import { ProductGallery } from "@/components/product-gallery";
import { Badge, Card, Kicker } from "@/components/ui";
import { db } from "@/lib/db";
import { productRecords } from "@/lib/db/schema";
import type { PoolImage, ProductReview, VariantAxis } from "@/lib/products/types";

export const dynamic = "force-dynamic";

/** Produit de démonstration : le sac Jeep, avec ses 37 images réelles. */
const DEMO_PRODUCT = "1005001843831532";

/**
 * MAQUETTE — l'étape 1 telle qu'elle devrait être.
 *
 * Rendue avec les vraies données du produit, sans passer par le parcours
 * payant : c'est là qu'on valide le rendu et l'ordre des sections.
 */
export default async function MockupPage() {
  const [record] = await db
    .select()
    .from(productRecords)
    .where(eq(productRecords.productId, DEMO_PRODUCT))
    .limit(1);

  if (!record) {
    return (
      <main className="mx-auto max-w-md px-5 py-16">
        <p className="text-sm text-stone-600">Produit de démonstration absent de la base.</p>
      </main>
    );
  }

  const images = record.images as PoolImage[];
  const axes = record.variantAxes as VariantAxis[];
  const reviews = record.reviews as ProductReview[];
  const specs = record.specs as Record<string, string>;
  const facts = record.facts as Record<string, { value?: unknown; confidence?: string; sources?: string[] }>;

  /** Un axe n'est proposé que s'il porte des images. */
  const colourAxis = axes.find((axis) => axis.values.some((value) => value.image));
  const colours = (colourAxis?.values ?? [])
    .filter((value) => value.image)
    .map((value) => ({ valueId: value.valueId, name: value.name, image: value.image }));

  const average =
    reviews.length > 0
      ? Math.round((reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length) * 10) / 10
      : null;

  const dims = facts.lengthWidthHeightMm?.value;
  const weight = facts.weightG?.value;
  const material = facts.material?.value;

  return (
    <main className="mx-auto max-w-md px-4 pb-20 pt-8">
      <div className="flex items-start justify-between gap-3">
        <Kicker>Étape 1 · maquette</Kicker>
        <Badge tone="ok">Produit prêt</Badge>
      </div>

      <h1 className="mt-1 text-lg font-semibold leading-snug">
        {String(record.title).replace(/\s+/g, " ").slice(0, 70)}
      </h1>
      <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
        {[facts.brand?.value, facts.model?.value, material].filter(Boolean).join(" · ")}
      </p>

      {/* ① Le bénéfice principal : toutes les photos */}
      <div className="mt-5">
        <ProductGallery
          images={images.map((image) => ({
            url: image.url,
            ...(image.variantValueId ? { variantValueId: image.variantValueId } : {}),
            ...(image.kind ? { kind: image.kind } : {}),
          }))}
          colours={colours}
          exportHref={`/api/demo/export/${DEMO_PRODUCT}`}
        />
      </div>

      {/* ② Ce qu'il mesure — replié, résumé visible */}
      <details className="mt-4 rounded-2xl border border-stone-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
          <span className="text-sm font-medium">Ce qu&apos;il mesure</span>
          <span className="text-[11px] text-stone-500">
            {Array.isArray(dims) ? `${dims.map((n) => n / 10).join(" × ")} cm` : "—"}
            {weight ? ` · ${weight} g` : ""}
          </span>
        </summary>
        <div className="border-t border-stone-100 px-4 py-3">
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Article</dt>
              <dd className="font-medium">
                {Array.isArray(dims) ? `${dims.map((n) => n / 10).join(" × ")} cm` : "non communiqué"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Poids</dt>
              <dd className="font-medium">{weight ? `${weight} g` : "non communiqué"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Emballage</dt>
              <dd className="text-stone-400">non communiqué</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Carton</dt>
              <dd className="text-stone-400">non communiqué</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] text-stone-400">
            Source : tableau de mesures de la fiche, lu par OCR · {facts.lengthWidthHeightMm?.confidence ?? "unique"}
          </p>
        </div>
      </details>

      {/* ③ Fiche technique */}
      <details className="mt-2 rounded-2xl border border-stone-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
          <span className="text-sm font-medium">Fiche technique</span>
          <span className="text-[11px] text-stone-500">{Object.keys(specs).length} champs</span>
        </summary>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-stone-100 px-4 py-3 text-[11px]">
          {Object.entries(specs).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="truncate text-stone-500">{key}</dt>
              <dd className="truncate font-medium" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {/* ④ Avis */}
      <details className="mt-2 rounded-2xl border border-stone-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
          <span className="text-sm font-medium">Ce que disent les acheteurs</span>
          <span className="text-[11px] text-stone-500">
            {average ? `${average}/5 · ${reviews.length} avis` : "aucun avis"}
          </span>
        </summary>
        <div className="space-y-3 border-t border-stone-100 px-4 py-3">
          {reviews.slice(0, 3).map((review) => (
            <div key={review.reviewId}>
              <p className="text-[11px] text-amber-600">
                {"★".repeat(review.rating)}
                <span className="text-stone-300">{"★".repeat(5 - review.rating)}</span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-stone-700">« {review.text.slice(0, 160)} »</p>
              <p className="mt-0.5 text-[10px] text-stone-400">
                {[review.buyerCountry, review.date].filter(Boolean).join(" · ")}
              </p>
            </div>
          ))}
        </div>
      </details>

      {/* Étape 2 */}
      <Card className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Étape 2</p>
        <h2 className="mt-1 text-base font-semibold">Étudier le marché</h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-600">
          Concurrents, désirs d&apos;acheteurs, objections et angles publicitaires.
        </p>
        <div className="mt-3 rounded-2xl bg-stone-900 px-5 py-3.5 text-center text-sm font-medium text-white">
          Lancer l&apos;étude — 1 000 FCFA
        </div>
      </Card>

      <p className="mt-6 text-center text-[11px] text-stone-400">
        Maquette — boutons inertes · <Link href="/demo" className="underline">retour à la démo</Link>
      </p>
    </main>
  );
}
