import { NextResponse } from "next/server";

import { readObject } from "@/lib/storage/r2";

export const runtime = "nodejs";

/**
 * Sert une image déposée dans R2 — **sans rendre le bucket public**.
 *
 * Pourquoi cette route existe : exiger `R2_PUBLIC_URL` faisait dépendre tout
 * l'upload d'un réglage de tableau de bord (activer le sous-domaine r2.dev,
 * ou brancher un domaine). Le bucket peut rester privé : la clé contient un
 * UUID, donc elle n'est pas devinable, et elle n'expire pas — contrairement
 * à une URL signée.
 *
 * Le cache est immutable : la clé change à chaque envoi.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const path = (key ?? []).join("/");

  if (!path) return NextResponse.json({ error: "BAD_KEY" }, { status: 400 });

  const object = await readObject(path);
  if (!object) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return new Response(object.body as unknown as BodyInit, {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(object.body.byteLength),
    },
  });
}
