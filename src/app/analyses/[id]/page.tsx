import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmArticle } from "@/components/confirm-article";
import { Badge, Card, Kicker, ScoreBar, type Tone } from "@/components/ui";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";

const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  bloquee_article: { label: "Article non identifié", tone: "warn" },
  appariement: { label: "Article identifié", tone: "ok" },
  planche_prete: { label: "Planche prête", tone: "info" },
  en_attente_validation: { label: "En attente de ta validation", tone: "info" },
  echouee: { label: "Échec", tone: "risk" },
  reservee: { label: "Démarrée", tone: "muted" },
  ocr: { label: "Lecture des photos", tone: "muted" },
};

interface StoredMatch {
  score?: number;
  coverage?: number;
  gateReason?: string;
  components?: Record<string, { points: number; max: number; evidence: boolean; detail: string }>;
}

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/wallet");

  const { id } = await params;
  const [row] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!row) notFound();

  const status = STATUS_LABEL[row.status] ?? { label: row.status, tone: "muted" as Tone };
  const match = (row.matchResult ?? {}) as StoredMatch;
  const blocked = row.status === "bloquee_article";

  return (
    <main className="mx-auto max-w-md px-5 pb-16 pt-10">
      <Kicker>Analyse</Kicker>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {row.archetypeSlug ? row.archetypeSlug.replace(/-/g, " ") : "Produit"}
        </h1>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <Card className="mt-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{row.matchScore ?? "—"}</p>
            <p className="text-xs text-stone-500">Correspondance / 100</p>
          </div>
          <p className="text-xs text-stone-500">
            couverture {row.matchCoverage ? `${Math.round(Number(row.matchCoverage) * 100)} %` : "—"}
          </p>
        </div>

        {match.components && (
          <div className="mt-4 space-y-2.5">
            {[
              ["Visuel", "visual"],
              ["Texte (OCR)", "ocr"],
              ["Attributs", "attributes"],
              ["Variante", "variant"],
            ].map(([label, key]) => {
              const component = match.components?.[key as string];
              if (!component) return null;
              return (
                <div key={key as string}>
                  <ScoreBar label={label as string} value={component.points} max={component.max} />
                  <p className="mt-0.5 text-[10px] text-stone-400">
                    {component.evidence ? component.detail : "aucune preuve disponible"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {blocked && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium">Aucun débit n&apos;a été effectué</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">
            Le produit n&apos;a pas pu être confirmé automatiquement
            {row.failureCode ? ` (${row.failureCode})` : ""}. La réservation de crédit a été
            intégralement restituée.
          </p>
          <ConfirmArticle analysisId={row.id} />
        </Card>
      )}

      {!blocked && row.status === "appariement" && (
        <Card className="mt-4">
          <p className="text-sm font-medium">Article identifié</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            La construction de la planche et la recherche marché prennent le relais.
            Le crédit reste réservé jusqu&apos;à la livraison des kits.
          </p>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        <Link
          href="/nouveau"
          className="block rounded-2xl border border-stone-300 px-5 py-3.5 text-center text-sm font-medium"
        >
          Analyser un autre produit
        </Link>
        <Link href="/demo" className="block text-center text-xs text-stone-500 underline">
          Voir un kit complet de démonstration
        </Link>
      </div>
    </main>
  );
}
