import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  ALLOWED_TYPES,
  MAX_UPLOADS,
  presignUpload,
  r2Configured,
} from "@/lib/storage/r2";

export const runtime = "nodejs";

const bodySchema = z.object({
  files: z
    .array(z.object({ contentType: z.string().min(1) }))
    .min(1)
    .max(MAX_UPLOADS),
});

/**
 * URL présignées pour l'envoi direct vers R2.
 *
 * Réponse 503 si R2 n'est pas configuré : le client retombe alors sur les
 * data URL, sans casser le parcours. Une dégradation déclarée, jamais silencieuse.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  if (!r2Configured()) {
    return NextResponse.json(
      { error: "STORAGE_NOT_CONFIGURED", message: "Envoi direct indisponible." },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }

  const invalid = parsed.data.files.find(
    (file) => !ALLOWED_TYPES.includes(file.contentType as (typeof ALLOWED_TYPES)[number]),
  );
  if (invalid) {
    return NextResponse.json({ error: "UNSUPPORTED_TYPE", type: invalid.contentType }, { status: 415 });
  }

  const uploads = await Promise.all(
    parsed.data.files.map((file) =>
      presignUpload({ userId: session.user.id, contentType: file.contentType }),
    ),
  );

  return NextResponse.json({ uploads }, { headers: { "Cache-Control": "no-store" } });
}
