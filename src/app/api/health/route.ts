import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sonde de santé — répond à la panne silencieuse la plus dangereuse :
 * « tous les modèles sont retirés, toutes les analyses bloquent, personne
 * ne le sait ».
 *
 * On interroge la liste des modèles (gratuit, sans quota) plutôt que de
 * générer du contenu : une sonde qui consomme du quota finit désactivée.
 */
interface Check {
  name: string;
  ok: boolean;
  detail: string;
  critical: boolean;
}

async function checkDatabase(): Promise<Check> {
  try {
    await db.execute(sql`select 1`);
    return { name: "database", ok: true, detail: "ok", critical: true };
  } catch (error) {
    return { name: "database", ok: false, detail: String(error).slice(0, 160), critical: true };
  }
}

async function checkGemini(): Promise<Check> {
  if (!env.GEMINI_API_KEY) {
    return { name: "gemini", ok: false, detail: "GEMINI_API_KEY absente", critical: true };
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" },
    );
    if (!res.ok) {
      return { name: "gemini", ok: false, detail: `HTTP ${res.status}`, critical: true };
    }
    const body = (await res.json()) as { models?: { name?: string }[] };
    const names = new Set((body.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, "")));

    const generation = [env.GEMINI_MODEL, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
      .filter((name) => names.has(name));
    // L'embedding n'a AUCUN repli dans le code : sa disparition casse la
    // recherche visuelle sans bruit. C'est donc lui qu'on surveille.
    const embedding = ["gemini-embedding-2", "gemini-embedding-001", "text-embedding-004"]
      .filter((name) => names.has(name));

    const ok = generation.length > 0 && embedding.length > 0;
    return {
      name: "gemini",
      ok,
      detail: `génération : ${generation.join(", ") || "aucun"} · embedding : ${embedding.join(", ") || "aucun"} (${names.size} modèles visibles)`,
      critical: true,
    };
  } catch (error) {
    return { name: "gemini", ok: false, detail: String(error).slice(0, 160), critical: true };
  }
}

async function checkApify(): Promise<Check> {
  if (!env.APIFY_TOKEN) {
    return { name: "apify", ok: false, detail: "APIFY_TOKEN absente — identification payante désactivée", critical: false };
  }
  try {
    const res = await fetch(
      `https://api.apify.com/v2/users/me?token=${encodeURIComponent(env.APIFY_TOKEN)}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" },
    );
    return {
      name: "apify",
      ok: res.ok,
      detail: res.ok ? "ok" : `HTTP ${res.status}`,
      critical: false,
    };
  } catch (error) {
    return { name: "apify", ok: false, detail: String(error).slice(0, 160), critical: false };
  }
}

export async function GET() {
  const checks = await Promise.all([checkDatabase(), checkGemini(), checkApify()]);
  const critical = checks.filter((c) => c.critical && !c.ok);

  return NextResponse.json(
    {
      ok: critical.length === 0,
      checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      at: new Date().toISOString(),
    },
    {
      status: critical.length === 0 ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
