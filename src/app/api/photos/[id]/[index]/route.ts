import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Sert une photo de produit.
 *
 * Les photos arrivent en data URL (compressées sur le téléphone). Les acteurs
 * Apify ont besoin d'une **URL publique** pour aller la chercher : cet endpoint
 * la leur fournit, sans stockage externe.
 *
 * L'identifiant est un UUID non devinable ; la photo reste celle du commerçant.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const { id, index } = await params;
  const position = Number(index);
  if (!Number.isInteger(position) || position < 0 || position > 5) {
    return NextResponse.json({ error: "BAD_INDEX" }, { status: 400 });
  }

  const [row] = await db
    .select({ photos: analyses.photos })
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1);

  const url = row?.photos?.[position]?.url;
  if (!url) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const match = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(url);
  if (!match) {
    // Une URL distante est redirigée telle quelle.
    return NextResponse.redirect(url);
  }

  const bytes = Buffer.from(match[2] as string, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": match[1] as string,
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Length": String(bytes.length),
    },
  });
}
