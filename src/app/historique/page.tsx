import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, Card, Kicker, type Tone } from "@/components/ui";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  livree: { label: "Kits livrés", tone: "ok" },
  bloquee_article: { label: "Article non reconnu", tone: "warn" },
  planche_prete: { label: "Planche à compléter", tone: "warn" },
  echouee: { label: "Échec", tone: "risk" },
  ocr: { label: "En cours", tone: "muted" },
};

export default async function HistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/wallet");

  const rows = await db
    .select({
      id: analyses.id,
      status: analyses.status,
      archetypeSlug: analyses.archetypeSlug,
      country: analyses.country,
      matchScore: analyses.matchScore,
      createdAt: analyses.createdAt,
    })
    .from(analyses)
    .where(eq(analyses.userId, session.user.id))
    .orderBy(desc(analyses.createdAt))
    .limit(30);

  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-10">
      <Kicker>Historique</Kicker>
      <h1 className="mt-1 text-xl font-semibold">Tes analyses</h1>

      {rows.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-stone-600">Aucune analyse pour l&apos;instant.</p>
          <Link
            href="/nouveau"
            className="mt-3 block rounded-2xl bg-stone-900 px-5 py-3.5 text-center text-sm font-medium text-white"
          >
            Analyser mon premier produit
          </Link>
        </Card>
      ) : (
        <ul className="mt-5 space-y-2">
          {rows.map((row) => {
            const status = STATUS[row.status] ?? { label: row.status, tone: "muted" as Tone };
            return (
              <li key={row.id}>
                <Link
                  href={`/analyses/${row.id}`}
                  className="block rounded-2xl border border-stone-200 bg-white p-4 active:scale-[0.995]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium capitalize">
                      {(row.archetypeSlug ?? "produit").replace(/-/g, " ")}
                    </p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-stone-500">
                    {row.country} ·{" "}
                    {new Date(row.createdAt).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {row.matchScore !== null && ` · ${row.matchScore}/100`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 space-y-3">
        <Link
          href="/nouveau"
          className="block rounded-2xl bg-stone-900 px-5 py-3.5 text-center text-sm font-medium text-white"
        >
          Analyser un produit
        </Link>
        <Link href="/wallet" className="block text-center text-xs text-stone-500 underline">
          Mon wallet
        </Link>
      </div>
    </main>
  );
}
