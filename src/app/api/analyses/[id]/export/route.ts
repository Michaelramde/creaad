import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses, productRecords } from "@/lib/db/schema";
import {
  buildDossierMarkdown,
  dossierFiles,
  type DossierSource,
} from "@/lib/export/product-dossier";
import { createZip, type ZipEntry } from "@/lib/export/zip";
import type { PoolImage, ProductReview, VariantAxis } from "@/lib/products/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Export du dossier produit d'une analyse.
 *
 * Le contenu suit la **sélection du commerçant** : les coloris décochés ne
 * partent pas. Les images de mesures et le marketing, sans coloris, restent
 * toujours : ce sont elles qui portent les dimensions.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await params;
  const [analysis] = await db
    .select({
      id: analyses.id,
      productRef: analyses.productRef,
      selectedVariants: analyses.selectedVariants,
      status: analyses.status,
    })
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!analysis) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!analysis.productRef) {
    return NextResponse.json({ error: "NO_PRODUCT" }, { status: 409 });
  }

  const [record] = await db
    .select()
    .from(productRecords)
    .where(eq(productRecords.productId, analysis.productRef))
    .limit(1);

  if (!record) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const source: DossierSource = {
    productId: record.productId,
    title: record.title,
    url: record.url,
    specs: record.specs as Record<string, string>,
    facts: record.facts as DossierSource["facts"],
    images: record.images as PoolImage[],
    variantAxes: record.variantAxes as VariantAxis[],
    reviews: record.reviews as ProductReview[],
  };

  // La décision enregistrée fait foi ; à défaut, tout est exporté.
  const selected = analysis.selectedVariants ?? undefined;

  const entries: ZipEntry[] = [
    {
      name: "fiche-produit.md",
      data: new TextEncoder().encode(buildDossierMarkdown(source, selected)),
    },
  ];

  for (const file of dossierFiles(source, selected)) {
    try {
      const res = await fetch(file.image.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      entries.push({ name: file.name, data: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      // Une image morte ne doit pas faire échouer tout l'export.
    }
  }

  const zip = createZip(entries);
  const slug = String(record.productId).replace(/\W/g, "");

  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="produit-${slug}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
