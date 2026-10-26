import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmArticle } from "@/components/confirm-article";
import { CopyButton } from "@/components/copy-button";
import { MarketStepButton } from "@/components/market-step-button";
import { ProductGallery } from "@/components/product-gallery";
import { RunProgress } from "@/components/run-progress";
import { WrongProductButton } from "@/components/wrong-product-button";
import { SafeImage } from "@/components/safe-image";
import { VariantPicker } from "@/components/variant-picker";
import { Badge, Card, Kicker, type Tone } from "@/components/ui";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses, archetypes, creativeKits, marketKits, planImages, plans, products } from "@/lib/db/schema";
import { ANGLE_LABELS, type AngleFamily } from "@/lib/market/types";
import { buildPortfolio } from "@/lib/market/portfolio";
import { buildMatrixForProduct } from "@/lib/market/store";
import type { PoolImage } from "@/lib/products/types";
import { getFreshRecord } from "@/lib/products/records";

interface StoredEnrichment {
  competitors?: {
    name: string;
    url: string;
    adsCount: number;
    longestRunDays: number;
    hooks: { hook: string; daysRunning: number; url: string }[];
  }[];
  desires?: { level: number; statement: string; evidence: string[] }[];
  objections?: { objection: string; counterAngle: string; evidence: string[] }[];
  personas?: { name: string; profile: string; verbatims: { quote: string; sourceUrl: string }[] }[];
  riskFlags?: { type: string; severity: string; note: string }[];
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  livree: { label: "Kits livrés", tone: "ok" },
  produit_pret: { label: "Produit prêt", tone: "ok" },
  variante_a_choisir: { label: "Coloris à choisir", tone: "info" },
  bloquee_article: { label: "Produit non identifié", tone: "warn" },
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

interface StoredMatch {
  score?: number;
  accepted?: boolean;
  candidate?: { title?: string; url?: string; images?: { url: string }[] };
  product?: {
    title?: string;
    url?: string;
    image?: string | null;
    productId?: string;
    price?: number | null;
    currency?: string | null;
    facts?: Record<string, unknown>;
  };
  components?: Record<string, { points: number; max: number; evidence: boolean; detail: string }>;
  gateReason?: string;
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
  const match = (row.matchResult ?? null) as StoredMatch | null;
  const photos = (row.photos ?? []).map((p) => p.url);

  const enrichment = (row.marketEnrichment ?? null) as StoredEnrichment | null;

  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.analysisId, row.id))
    .orderBy(desc(plans.createdAt))
    .limit(1);

  const images = plan
    ? await db.select().from(planImages).where(eq(planImages.planId, plan.id))
    : [];

  const [creative] = await db
    .select()
    .from(creativeKits)
    .where(eq(creativeKits.analysisId, row.id))
    .limit(1);

  const kit = (creative?.content ?? null) as {
    bigIdea?: string;
    angles?: {
      id: string;
      hook: string;
      promise: string;
      proof: string;
      objectionHandled: string;
      sourceAngleRef: string;
    }[];
    hooks?: { format: string; text: string }[];
    scripts?: { format: string; durationS: number; scenes: { atS: number; visual: string }[] }[];
    imagePrompts?: { prompt: string }[];
  } | null;

  let portfolio: PortfolioEntry[] | null = null;
  let marketMeta: { adsFound: number; confidence: string } | null = null;
  let archetypeLabel: string | null = null;

  /**
   * Marché du produit : il **s'ajoute** au marché de l'archétype, il ne le
   * remplace pas. Un produit n'a souvent que 5 annonces — les remplacer par
   * 45 annonces de marché générique serait une perte d'information.
   */
  let productPortfolio: PortfolioEntry[] | null = null;
  let productMarket: { adsFound: number; scope: string | null; note: string | null } | null = null;

  /** Toutes les photos trouvées du produit — galerie, description, avis. */
  let gallery: PoolImage[] = [];
  let variantImages: string[] = [];

  const productRecord = row.productRef ? await getFreshRecord("aliexpress", row.productRef) : null;

  if (productRecord) {
    gallery = productRecord.images.filter((image) => image.origin !== "variant");
    variantImages = productRecord.variantAxes.flatMap((axis) =>
      axis.values.map((value) => value.image).filter((url): url is string => Boolean(url)),
    );
  }

  /** Un axe n'est proposé que s'il porte des images : sinon il ne se choisit pas. */
  const colourAxis = productRecord?.variantAxes.find((axis) =>
    axis.values.some((value) => value.image),
  );
  const variantColours = (colourAxis?.values ?? [])
    .filter((value) => value.image)
    .map((value) => ({ valueId: value.valueId, name: value.name, image: value.image as string }));

  /* ── Dimensions et spécifications, avec leur portée ───────────────────── */
  const dims = productRecord?.facts.lengthWidthHeightMm?.value;
  const weight = productRecord?.facts.weightG?.value;
  const dimensionLabel = Array.isArray(dims)
    ? `${(dims as number[]).map((mm) => mm / 10).join(" × ")} cm`
    : null;
  const weightLabel = typeof weight === "number" ? `${weight} g` : null;
  const specEntries = Object.entries((productRecord?.specs ?? {}) as Record<string, string>);
  const reviewAverage =
    productRecord && productRecord.reviews.length > 0
      ? Math.round(
          (productRecord.reviews.reduce((total, review) => total + review.rating, 0) /
            productRecord.reviews.length) *
            10,
        ) / 10
      : null;

  if (row.productRef && row.status === "livree") {
    const built = await buildMatrixForProduct(row.productRef, row.country);
    if (built && built.matrix.dataQuality.adsFound >= 5) {
      productPortfolio = buildPortfolio(built.matrix).entries as PortfolioEntry[];
      if (productPortfolio.length > 0) {
        productMarket = {
          adsFound: built.matrix.dataQuality.adsFound,
          scope: row.marketScope,
          note: row.marketNote,
        };
      }
    }
  }

  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, row.productId))
    .limit(1);

  if (row.archetypeSlug) {
    const [archetype] = await db
      .select({ id: archetypes.id, label: archetypes.label })
      .from(archetypes)
      .where(eq(archetypes.slug, row.archetypeSlug))
      .limit(1);

    archetypeLabel = archetype?.label ?? null;

    if (archetype) {
      const [cache] = await db
        .select()
        .from(marketKits)
        .where(and(eq(marketKits.archetypeId, archetype.id), eq(marketKits.country, row.country)))
        .limit(1);

      // Le marché de l'archétype ne sert que de repli : s'il a déjà été
      // remplacé par celui du produit, on ne l'écrase pas.
      if (cache) {
        const content = cache.content as { portfolio?: { entries?: PortfolioEntry[] } };
        portfolio = content.portfolio?.entries ?? null;
        marketMeta = { adsFound: cache.adsFound, confidence: cache.confidence };
      }
    }
  }

  const pendingVariant = row.status === "variante_a_choisir";
  // Un produit identifié fait foi, même si l'ancien matcher n'a pas conclu :
  // les deux voies coexistent et seule la payante a le dernier mot.
  const identified = match?.accepted === true || Boolean(match?.product) || pendingVariant;
  const candidateImage = match?.product?.image ?? match?.candidate?.images?.[0]?.url ?? null;
  const candidateTitle = match?.product?.title ?? match?.candidate?.title ?? null;
  const candidateUrl = match?.product?.url ?? match?.candidate?.url ?? null;

  // Le nom saisi d'abord, puis le produit réellement identifié : « Sac » seul
  // ne dit rien au commerçant.
  const title =
    product?.name?.trim() ||
    match?.product?.title ||
    archetypeLabel ||
    (row.archetypeSlug ? row.archetypeSlug.replace(/-/g, " ") : "Produit");

  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Kicker>Analyse</Kicker>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <RunProgress status={row.status} startedAt={row.createdAt.toISOString()} />

      {/* Les photos du commerçant, toujours visibles */}
      {photos.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {photos.map((url, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={url}
              alt=""
              className="h-20 w-20 shrink-0 rounded-xl border border-stone-200 object-cover"
            />
          ))}
        </div>
      )}

      {/* Verdict */}
      <div className="mt-4 flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4">
        <ScoreRing value={row.matchScore ?? 0} tone={identified ? "ok" : "warn"} />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {pendingVariant ? "Produit retrouvé" : identified ? "Produit retrouvé" : "Produit non retrouvé"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            {pendingVariant
              ? "Le produit a été identifié chez le fournisseur. Choisis le coloris que tu vends."
              : match?.product
                ? explainProduct(match)
                : identified
                  ? explainScore(match)
                  : explainFailure(match)}
          </p>
        </div>
      </div>

      {/* Le produit réellement comparé */}
      {candidateTitle && (
        <Card className="mt-3 flex gap-3">
          {candidateImage && (
            <SafeImage
              src={candidateImage}
              className="h-16 w-16 shrink-0 rounded-xl border border-stone-200 object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-stone-400">
              {identified ? "Produit de référence" : "Le plus proche trouvé"}
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-stone-700">
              {candidateTitle}
            </p>
            {candidateUrl && (
              <a
                href={candidateUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[11px] text-stone-500 underline"
              >
                Voir l&apos;annonce
              </a>
            )}
          </div>
        </Card>
      )}

      {/* Le recours manquait : un faux positif était facturé sans issue. */}
      {(row.status === "livree" || row.status === "produit_pret") && identified && (
        <WrongProductButton analysisId={row.id} />
      )}

      {/* Coloris à choisir */}
      {pendingVariant && row.pendingVariants && row.pendingVariants.length > 0 && (
        <VariantPicker
          analysisId={row.id}
          axes={row.pendingVariants}
          creditXof={row.reservedXof ?? 0}
        />
      )}

      {/* 1 · Le dossier produit — le bénéfice de l'étape 1 */}
      {gallery.length > 0 && (
        <section className="mt-5">
          <ProductGallery
            images={gallery.map((image) => ({
              url: image.url,
              ...(image.kind ? { kind: image.kind } : {}),
              ...(image.variantValueId ? { variantValueId: image.variantValueId } : {}),
            }))}
            colours={variantColours}
            initialSelected={row.selectedVariants ?? undefined}
            initialCorrections={row.imageCorrections ?? undefined}
            analysisId={row.id}
            exportHref={`/api/analyses/${row.id}/export`}
          />
        </section>
      )}

      {/* Ce qu'il mesure — replié, résumé visible */}
      <details className="mt-3 rounded-2xl border border-stone-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
          <span className="text-sm font-medium">Ce qu&apos;il mesure</span>
          <span className="text-[11px] text-stone-500">
            {dimensionLabel ?? "non communiqué"}
            {weightLabel ? ` · ${weightLabel}` : ""}
          </span>
        </summary>
        <div className="border-t border-stone-100 px-4 py-3">
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Article</dt>
              <dd className="font-medium">{dimensionLabel ?? "non communiqué"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Poids</dt>
              <dd className="font-medium">{weightLabel ?? "non communiqué"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Emballage</dt>
              <dd className="text-stone-400">non communiqué</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-stone-500">Carton</dt>
              <dd className="text-stone-400">non communiqué</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] text-stone-400">
            Source : tableau de mesures de la fiche, lu par OCR.
          </p>
        </div>
      </details>

      {/* Fiche technique */}
      {specEntries.length > 0 && (
        <details className="mt-2 rounded-2xl border border-stone-200 bg-white">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
            <span className="text-sm font-medium">Fiche technique</span>
            <span className="text-[11px] text-stone-500">{specEntries.length} champs</span>
          </summary>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-stone-100 px-4 py-3 text-[11px]">
            {specEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="truncate text-stone-500">{key}</dt>
                <dd className="truncate font-medium" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {/* Avis clients */}
      {productRecord && productRecord.reviews.length > 0 && (
        <details className="mt-2 rounded-2xl border border-stone-200 bg-white">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
            <span className="text-sm font-medium">Ce que disent les acheteurs</span>
            <span className="text-[11px] text-stone-500">
              {reviewAverage}/5 · {productRecord.reviews.length} avis
            </span>
          </summary>
          <div className="space-y-3 border-t border-stone-100 px-4 py-3">
            {productRecord.reviews.slice(0, 4).map((review) => (
              <div key={review.reviewId}>
                <p className="text-[11px] text-amber-600">
                  {"★".repeat(review.rating)}
                  <span className="text-stone-300">{"★".repeat(5 - review.rating)}</span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-stone-700">
                  « {review.text.slice(0, 200)} »
                </p>
                <p className="mt-0.5 text-[10px] text-stone-400">
                  {[review.buyerCountry, review.date].filter(Boolean).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 2a · Convaincre — le produit */}
      {productPortfolio && productPortfolio.length > 0 && (
        <section className="mt-6">
          <Kicker>Convaincre · ce produit ({productMarket?.adsFound} annonces)</Kicker>
          {productMarket?.note && (
            <p className="mt-1 text-[11px] leading-relaxed text-stone-500">{productMarket.note}</p>
          )}
          <div className="mt-2 space-y-2">
            {productPortfolio.slice(0, 6).map((entry) => (
              <Card key={`p-${entry.family}`}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    {ANGLE_LABELS[entry.family as AngleFamily] ?? entry.family}
                  </h2>
                  <Badge tone={ACTION_TONE[entry.action] ?? "muted"}>
                    {ACTION_LABEL[entry.action] ?? entry.action}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-stone-500">
                  {entry.figures.advertisers} annonceur{entry.figures.advertisers > 1 ? "s" : ""} ·{" "}
                  {Math.round(entry.figures.medianDaysRunning)} j de diffusion médiane
                </p>
                <p className="mt-2 text-xs leading-relaxed text-stone-700">{entry.rationale}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Étape 1 terminée : le dossier produit se suffit, l'étude de marché
          est une seconde demande explicitement facturée. */}
      {row.status === "produit_pret" && (
        <MarketStepButton
          analysisId={row.id}
          creditXof={
            marketMeta && portfolio && portfolio.length > 0
              ? Number(process.env.NEXT_PUBLIC_CREDIT_XOF_CACHED ?? 500)
              : Number(process.env.NEXT_PUBLIC_CREDIT_XOF ?? 1000)
          }
          cached={Boolean(marketMeta && portfolio && portfolio.length > 0)}
        />
      )}

      {/*
        Le marché de l'archétype n'est plus affiché : il parle du type de
        produit, pas de celui du commerçant. Il reste calculé et stocké — il
        alimente le kit production et sert de repli.
      */}

      {/* 2b · Les vendeurs de ce produit */}
      {enrichment?.competitors && enrichment.competitors.length > 0 && (
        <section className="mt-6">
          <Kicker>Qui vend ce produit ({enrichment.competitors.length})</Kicker>
          <div className="mt-2 space-y-2">
            {enrichment.competitors.slice(0, 5).map((competitor) => (
              <Card key={competitor.url}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold">{competitor.name}</h2>
                  <Badge tone="muted">
                    {competitor.adsCount} annonce{competitor.adsCount > 1 ? "s" : ""}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-stone-500">
                  Plus longue diffusion : {competitor.longestRunDays} jours
                </p>
                {competitor.hooks[0] && (
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-stone-700">
                    « {competitor.hooks[0].hook} »
                  </p>
                )}
                <a
                  href={competitor.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[11px] text-stone-500 underline"
                >
                  Voir son annonce
                </a>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* 2c · Désirs et objections */}
      {(enrichment?.desires?.length || enrichment?.objections?.length) && (
        <section className="mt-6">
          <Kicker>Ce que veulent les acheteurs</Kicker>
          <div className="mt-2 space-y-2">
            {(enrichment?.desires ?? []).map((desire) => (
              <Card key={desire.statement}>
                <div className="flex items-start gap-2">
                  <Badge tone="info">niveau {desire.level}</Badge>
                  <p className="text-xs leading-relaxed text-stone-700">{desire.statement}</p>
                </div>
                <p className="mt-1 text-[10px] text-stone-400">
                  {desire.evidence.length} annonce{desire.evidence.length > 1 ? "s" : ""} à l&apos;appui
                </p>
              </Card>
            ))}
          </div>

          {(enrichment?.objections ?? []).length > 0 && (
            <>
              <Kicker>Ce qui bloque l&apos;achat</Kicker>
              <div className="mt-2 space-y-2">
                {(enrichment?.objections ?? []).map((objection) => (
                  <Card key={objection.objection}>
                    <p className="text-sm font-medium">{objection.objection}</p>
                    <p className="mt-1 text-xs leading-relaxed text-stone-600">
                      Contre-angle : {objection.counterAngle}
                    </p>
                  </Card>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* 3 · Produire */}
      {identified && (!portfolio || portfolio.length === 0) && (
        <Card className="mt-6">
          <Kicker>Convaincre</Kicker>
          <p className="mt-1 text-sm text-stone-700">
            Pas encore d&apos;annonces collectées pour ce modèle.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            La collecte tourne toutes les 6 heures sur les archétypes du catalogue. Les angles du
            marché apparaîtront ici dès que ce modèle sera couvert.
          </p>
        </Card>
      )}

      {row.status === "livree" && !(kit?.angles && kit.angles.length > 0) && (
        <section className="mt-6">
          <Kicker>Produire · tes créas</Kicker>
          <Card className="mt-2">
            <p className="text-sm text-stone-700">Rédaction du kit production en cours…</p>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">
              Le rédacteur a été momentanément indisponible. Le kit se complète tout seul dans
              quelques secondes — recharge la page.
            </p>
          </Card>
        </section>
      )}

      {kit?.angles && kit.angles.length > 0 && (
        <section className="mt-6">
          <Kicker>Produire · tes créas</Kicker>

          {kit.bigIdea?.trim() ? (
            // Pas de `Card` ici : son fond blanc l'emporterait sur le fond
            // sombre, et le texte blanc deviendrait invisible.
            <div className="mt-2 rounded-2xl bg-stone-900 p-4 text-white">
              <p className="text-[15px] leading-relaxed">{kit.bigIdea}</p>
            </div>
          ) : null}          <div className="mt-2 space-y-2">
            {kit.angles.slice(0, 3).map((angle) => (
              <Card key={angle.id}>
                <p className="text-sm font-semibold">« {angle.hook} »</p>
                <p className="mt-1 text-xs leading-relaxed text-stone-700">{angle.promise}</p>
                <dl className="mt-2 space-y-1 text-[11px] text-stone-600">
                  <div className="flex gap-1.5">
                    <dt className="w-24 shrink-0 text-stone-400">Preuve</dt>
                    <dd>{angle.proof}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="w-24 shrink-0 text-stone-400">Objection</dt>
                    <dd>{angle.objectionHandled}</dd>
                  </div>
                </dl>
                <div className="mt-2">
                  <Badge tone="muted">
                    angle : {ANGLE_LABELS[angle.sourceAngleRef as AngleFamily] ?? angle.sourceAngleRef}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>

          {kit.scripts?.[0] && (
            <Card className="mt-2">
              <Kicker>
                Script {kit.scripts[0].durationS} s · {kit.scripts[0].format}
              </Kicker>
              <ol className="mt-2 space-y-2">
                {kit.scripts[0].scenes.map((scene) => (
                  <li key={scene.atS} className="flex gap-2">
                    <span className="w-8 shrink-0 text-[11px] tabular-nums text-stone-400">
                      {scene.atS}s
                    </span>
                    <span className="text-xs">{scene.visual}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {kit.imagePrompts?.[0] && (
            <details className="mt-2 rounded-2xl border border-stone-200 bg-white p-4">
              <summary className="cursor-pointer text-xs font-medium text-stone-700">
                Prompt d&apos;image ({kit.imagePrompts.length})
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-stone-900 p-3 text-[11px] leading-relaxed text-stone-100">
{kit.imagePrompts[0].prompt}
              </pre>
            </details>
          )}
        </section>
      )}

      {!identified && row.status === "bloquee_article" && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium">Aucun débit n&apos;a été effectué</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">
            Le produit n&apos;a pas pu être confirmé. {advice(match)}
          </p>
          <ConfirmArticle analysisId={row.id} />
        </Card>
      )}

      {row.status === "planche_prete" && plan && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium">Aucun débit n&apos;a été effectué</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">
            Il manque des vues du produit. Reprends les photos manquantes, puis relance.
          </p>
        </Card>
      )}

      <div className="mt-8 space-y-3">
        {kit?.angles && kit.angles.length > 0 && (
          <details className="rounded-2xl border border-stone-200 bg-white p-4">
            <summary className="cursor-pointer text-xs font-medium text-stone-700">
              Emporter le kit (texte à copier)
            </summary>
            <div className="mt-3 flex justify-end">
              <CopyButton text={buildExport(row.archetypeSlug, portfolio, kit)} label="Copier le kit" />
            </div>
            <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-700">
{buildExport(row.archetypeSlug, portfolio, kit)}
            </pre>
          </details>
        )}

        <Link
          href="/nouveau"
          className="block rounded-2xl bg-stone-900 px-5 py-3.5 text-center text-sm font-medium text-white"
        >
          Analyser un autre produit
        </Link>
        <Link href="/historique" className="block text-center text-xs text-stone-500 underline">
          Mes analyses
        </Link>
      </div>
    </main>
  );
}

/** Anneau de score : un chiffre seul ne dit rien. */
function ScoreRing({ value, tone }: { value: number; tone: "ok" | "warn" }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(100, value)) / 100;

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#e7e5e4" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={tone === "ok" ? "#1c1917" : "#b45309"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}

/** Verdict quand le produit vient de la fiche fournisseur, pas du matcher. */
function explainProduct(match: StoredMatch | null): string {
  const factKeys = Object.keys(match?.product?.facts ?? {}).length;
  const price = match?.product?.price;
  const currency = match?.product?.currency;

  const parts = ["Fiche fournisseur retrouvée par l'image."];
  if (typeof price === "number") parts.push(`Prix public ${price} ${currency ?? ""}`.trim() + ".");
  if (factKeys > 0) parts.push(`${factKeys} fait(s) vérifié(s).`);
  return parts.join(" ");
}

function explainScore(match: StoredMatch | null): string {  const visual = match?.components?.visual;
  const text = match?.components?.ocr;
  if (visual && visual.points > visual.max * 0.6) return "La photo et l'annonce montrent bien le même produit.";
  if (text && text.points > text.max * 0.6) return "Le nom du produit correspond à l'annonce trouvée.";
  return "Correspondance confirmée par les attributs du produit.";
}

function explainFailure(match: StoredMatch | null): string {
  const visual = match?.components?.visual;
  const text = match?.components?.ocr;
  if (visual && visual.evidence && visual.points < visual.max * 0.3)
    return "Les annonces trouvées ne montrent pas ce produit.";
  if (text && text.evidence && text.points < text.max * 0.3)
    return "Le nom du produit ne correspond pas aux annonces.";
  return "Les preuves recueillies ne suffisent pas à confirmer le produit.";
}

function advice(match: StoredMatch | null): string {
  const visual = match?.components?.visual;
  const text = match?.components?.ocr;
  if (visual && visual.evidence && visual.points < visual.max * 0.3)
    return "Précise le nom exact du modèle (marque + type) : c'est ce qui guide la recherche.";
  if (text && text.evidence && text.points < text.max * 0.3)
    return "Ajoute une photo de l'étiquette ou le nom exact du produit.";
  return "Reprends les photos à la lumière du jour, en montrant le produit entier.";
}

/** Version texte du kit, pour la coller dans un autre outil. */
function buildExport(
  archetype: string | null,
  portfolio: PortfolioEntry[] | null,
  kit: {
    bigIdea?: string;
    angles?: { hook: string; promise: string; proof: string; objectionHandled: string; sourceAngleRef: string }[];
    hooks?: { format: string; text: string }[];
    scripts?: { durationS: number; scenes: { atS: number; visual: string }[] }[];
    imagePrompts?: { prompt: string }[];
  },
): string {
  const lines: string[] = [];
  lines.push(`# Kit publicitaire — ${(archetype ?? "produit").replace(/-/g, " ")}`, "");

  if (kit.bigIdea) lines.push("## Idée directrice", kit.bigIdea, "");

  if (kit.angles?.length) {
    lines.push("## Angles");
    for (const angle of kit.angles) {
      lines.push(
        `### « ${angle.hook} »`,
        `- Promesse : ${angle.promise}`,
        `- Preuve : ${angle.proof}`,
        `- Objection traitée : ${angle.objectionHandled}`,
        `- Angle de marché : ${angle.sourceAngleRef}`,
        "",
      );
    }
  }

  if (kit.hooks?.length) {
    lines.push("## Hooks");
    for (const hook of kit.hooks) lines.push(`- [${hook.format}] ${hook.text}`);
    lines.push("");
  }

  if (kit.scripts?.length) {
    lines.push(`## Script ${kit.scripts[0]?.durationS ?? 15} s`);
    for (const scene of kit.scripts[0]?.scenes ?? []) lines.push(`- ${scene.atS}s — ${scene.visual}`);
    lines.push("");
  }

  if (kit.imagePrompts?.length) {
    lines.push("## Prompts d'image");
    for (const prompt of kit.imagePrompts) lines.push(`- ${prompt.prompt}`);
    lines.push("");
  }

  if (portfolio?.length) {
    lines.push("## Angles observés sur le marché");
    for (const entry of portfolio.slice(0, 6)) {
      lines.push(
        `- ${ANGLE_LABELS[entry.family as AngleFamily] ?? entry.family} — ${entry.action} (${entry.figures.advertisers} annonceurs, ${Math.round(entry.figures.medianDaysRunning)} j)`,
      );
    }
  }

  return lines.join("\n").trim();
}
