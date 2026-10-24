import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmArticle } from "@/components/confirm-article";
import { Badge, Card, Kicker, ScoreBar, type Tone } from "@/components/ui";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses, archetypes, marketKits, planImages, plans } from "@/lib/db/schema";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  livree: { label: "Kits livrés", tone: "ok" },
  bloquee_article: { label: "Article non identifié", tone: "warn" },
  planche_prete: { label: "Planche incomplète", tone: "warn" },
  echouee: { label: "Échec", tone: "risk" },
  ocr: { label: "En cours", tone: "muted" },
};

const ACTION_LABEL: Record<string, string> = {
  importer: "Importer",
  "tester-vite": "Tester vite",
  "garder-differencier": "Garder, changer l'exécution",
  surveiller: "Surveiller",
  ignorer: "Inconnu",
};

const ACTION_TONE: Record<string, Tone> = {
  importer: "ok",
  "tester-vite": "warn",
  "garder-differencier": "info",
  surveiller: "muted",
  ignorer: "muted",
};

interface PortfolioEntry {
  family: string;
  action: string;
  recommended: boolean;
  rationale: string;
  figures: { ads: number; advertisers: number; medianDaysRunning: number };
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

  const status = STATUS[row.status] ?? { label: row.status, tone: "muted" as Tone };
  const blockedArticle = row.status === "bloquee_article";

  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.analysisId, row.id))
    .orderBy(desc(plans.createdAt))
    .limit(1);

  const images = plan
    ? await db.select().from(planImages).where(eq(planImages.planId, plan.id))
    : [];

  let portfolio: PortfolioEntry[] | null = null;
  let marketMeta: { adsFound: number; advertisers: number; confidence: string } | null = null;

  if (row.archetypeSlug) {
    const [archetype] = await db
      .select({ id: archetypes.id })
      .from(archetypes)
      .where(eq(archetypes.slug, row.archetypeSlug))
      .limit(1);

    if (archetype) {
      const [kit] = await db
        .select()
        .from(marketKits)
        .where(and(eq(marketKits.archetypeId, archetype.id), eq(marketKits.country, row.country)))
        .limit(1);

      if (kit) {
        const content = kit.content as { portfolio?: { entries?: PortfolioEntry[] } };
        portfolio = content.portfolio?.entries ?? null;
        marketMeta = {
          adsFound: kit.adsFound,
          advertisers: 0,
          confidence: kit.confidence,
        };
      }
    }
  }

  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-10">
      <Kicker>Analyse</Kicker>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {row.archetypeSlug ? row.archetypeSlug.replace(/-/g, " ") : "Produit"}
        </h1>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {/* Identification */}
      <Card className="mt-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{row.matchScore ?? "—"}</p>
            <p className="text-xs text-stone-500">Correspondance article / 100</p>
          </div>
        </div>
      </Card>

      {/* Planche */}
      {plan && (
        <Card className="mt-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-semibold tabular-nums">{plan.fidelityScore}</p>
              <p className="text-xs text-stone-500">Fidélité de la planche / 100</p>
            </div>
            <Badge tone={plan.gatePassed ? "ok" : "warn"}>
              {plan.gatePassed ? "Validée" : "À compléter"}
            </Badge>
          </div>

          {images.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {images.map((image) => (
                <figure key={image.id} className="overflow-hidden rounded-xl border border-stone-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={image.slot}
                    className="aspect-square w-full object-cover"
                  />
                  <figcaption className="px-1.5 py-1 text-[10px] text-stone-500">
                    {image.slot.replace("-", " ")}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          {plan.qualityNote && (
            <p className="mt-3 text-xs leading-relaxed text-amber-800">{plan.qualityNote}</p>
          )}
        </Card>
      )}

      {/* Angles */}
      {portfolio && portfolio.length > 0 && (
        <section className="mt-6">
          <Kicker>Angles du marché · {marketMeta?.adsFound} annonces</Kicker>
          <div className="mt-2 space-y-2">
            {portfolio.slice(0, 6).map((entry) => (
              <Card key={entry.family}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold capitalize">
                    {entry.family.replace(/-/g, " ")}
                  </h2>
                  <Badge tone={ACTION_TONE[entry.action] ?? "muted"}>
                    {ACTION_LABEL[entry.action] ?? entry.action}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-stone-500">
                  {entry.figures.advertisers} annonceur
                  {entry.figures.advertisers > 1 ? "s" : ""} ·{" "}
                  {Math.round(entry.figures.medianDaysRunning)} j de diffusion médiane
                </p>
                <p className="mt-2 text-xs leading-relaxed text-stone-700">{entry.rationale}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {blockedArticle && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium">Aucun débit n&apos;a été effectué</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">
            Le produit n&apos;a pas pu être confirmé automatiquement. La réservation de crédit a
            été intégralement restituée.
          </p>
          <ConfirmArticle analysisId={row.id} />
        </Card>
      )}

      {row.status === "planche_prete" && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium">Aucun débit n&apos;a été effectué</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">
            La planche est incomplète : reprends les photos manquantes puis relance.
          </p>
        </Card>
      )}

      <div className="mt-8 space-y-3">
        <Link
          href="/nouveau"
          className="block rounded-2xl bg-stone-900 px-5 py-3.5 text-center text-sm font-medium text-white"
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
