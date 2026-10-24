import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { productRecords } from "@/lib/db/schema";
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
 * Export du dossier produit : un ZIP avec la fiche lisible et les photos
 * rangees par usage (produit / mesures / marketing).
 *
 * `?coloris=a,b` restreint aux coloris donnes ; sans parametre, tout part.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const selected = new URL(req.url).searchParams.get("coloris")?.split(",").filter(Boolean);

  const [record] = await db
    .select()
    .from(productRecords)
    .where(eq(productRecords.productId, id))
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
      // Une image morte ne doit pas faire echouer tout l'export.
    }
  }

  const zip = createZip(entries);

  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="produit-${record.productId}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}