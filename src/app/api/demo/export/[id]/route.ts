import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { productRecords } from "@/lib/db/schema";
import { createZip, type ZipEntry } from "@/lib/export/zip";
import type { PoolImage, ProductReview, VariantAxis } from "@/lib/products/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Export du dossier produit : un ZIP avec la fiche lisible et toutes les
 * photos rangées par coloris.
 *
 * C'est ce que le commerçant emporte — il l'a payé, il doit pouvoir le garder.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // `id` accepte un identifiant de produit (maquette) : on résout par le
  // productRef de l'analyse quand elle existe.
  const [record] = await db
    .select()
    .from(productRecords)
    .where(eq(productRecords.productId, id))
    .limit(1);

  if (!record) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const images = record.images as PoolImage[];
  const axes = record.variantAxes as VariantAxis[];
  const reviews = record.reviews as ProductReview[];
  const specs = record.specs as Record<string, string>;
  const facts = record.facts as Record<string, { value?: unknown; confidence?: string }>;

  const colours = axes.flatMap((axis) =>
    axis.values.map((value) => ({ valueId: value.valueId, name: value.name })),
  );
  const colourName = (valueId?: string) =>
    colours.find((colour) => colour.valueId === valueId)?.name.replace(/[^\w-]+/g, "-") ?? "technique";

  /* ── La fiche lisible ─────────────────────────────────────────────────── */
  const lines: string[] = [
    `# ${String(record.title).trim()}`,
    "",
    `- Marque : ${facts.brand?.value ?? "non communiqué"}`,
    `- Modèle : ${facts.model?.value ?? "non communiqué"}`,
    `- Matière : ${facts.material?.value ?? "non communiqué"}`,
    `- Référence fournisseur : ${record.productId}`,
    `- Lien : ${record.url}`,
    "",
    "## Dimensions",
    "",
    `- Article : ${Array.isArray(facts.lengthWidthHeightMm?.value) ? `${(facts.lengthWidthHeightMm.value as number[]).map((n) => n / 10).join(" × ")} cm` : "non communiqué"}`,
    `- Poids : ${facts.weightG?.value ? `${facts.weightG.value} g` : "non communiqué"}`,
    "- Emballage : non communiqué",
    "- Carton : non communiqué",
    "",
    "## Fiche technique",
    "",
    "| Caractéristique | Valeur |",
    "| --- | --- |",
    ...Object.entries(specs).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## Avis clients",
    "",
  ];

  if (reviews.length === 0) lines.push("Aucun avis collecté.");
  for (const review of reviews) {
    lines.push(
      `- ${"★".repeat(review.rating)} (${review.rating}/5) — ${[review.buyerCountry, review.date].filter(Boolean).join(", ")}`,
      `  « ${review.text.replace(/\s+/g, " ")} »`,
    );
  }

  lines.push("", "## Photos", "", `Total : ${images.length} images`, "");
  const labels: Record<string, string> = {
    packshot: "produit seul",
    scene: "en scène",
    spec: "produit + mesures",
    sans_produit: "sans produit",
  };

  for (const [index, image] of images.entries()) {
    const nature = labels[image.kind ?? "sans_produit"] ?? "sans produit";
    const colour = image.variantValueId ? colourName(image.variantValueId) : nature;
    lines.push(`${String(index + 1).padStart(2, "0")}. images/${imageFileName(index, image, colour)} — ${nature}${image.variantValueId ? ` · ${colour}` : ""}`);
  }

  const entries: ZipEntry[] = [
    { name: "fiche-produit.md", data: new TextEncoder().encode(lines.join("\n")) },
  ];

  /* ── Les photos ───────────────────────────────────────────────────────── */
  const encoder = new TextEncoder();
  void encoder;

  const fetched = await mapWithConcurrency(images, 6, async (image, index) => {
    try {
      const res = await fetch(image.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      const data = new Uint8Array(await res.arrayBuffer());
      return { name: `images/${imageFileName(index, image, colourName(image.variantValueId))}`, data };
    } catch {
      return null;
    }
  });

  for (const entry of fetched) if (entry) entries.push(entry);

  const zip = createZip(entries);

  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="produit-${record.productId}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

function imageFileName(index: number, image: PoolImage, colour: string): string {
  const extension = /\.(png|webp|jpe?g)(?:\?|$)/i.exec(image.url)?.[1]?.toLowerCase() ?? "jpg";
  return `${String(index + 1).padStart(2, "0")}-${colour}.${extension === "jpeg" ? "jpg" : extension}`;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index] as T, index);
      }
    }),
  );

  return results;
}
