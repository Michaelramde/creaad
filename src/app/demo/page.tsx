import Link from "next/link";

import { Badge, Card, Kicker, ScoreBar, SectionTitle, SourceLink, type Tone } from "@/components/ui";
import { demoKits } from "@/lib/demo/fixtures";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  proven_here: { label: "Prouvé ici", tone: "info" },
  proven_elsewhere: { label: "Prouvé ailleurs", tone: "ok" },
  rising: { label: "En montée", tone: "warn" },
  observed_unproven: { label: "Observé, non prouvé", tone: "muted" },
  unobserved: { label: "Inconnu", tone: "muted" },
};

const ACTION: Record<string, string> = {
  proven_elsewhere: "Importer",
  rising: "Tester vite",
  proven_here: "Garder, changer l'exécution",
  observed_unproven: "Surveiller",
  unobserved: "Ne pas conclure",
};

const PROVENANCE_LABEL: Record<string, string> = {
  utilisateur: "Commerçant",
  fournisseur: "Fournisseur",
  marchand: "Site marchand",
  concurrent: "Concurrent",
  generee: "Générée",
};

export default function DemoPage() {
  const { product, market, creative } = demoKits;

  const specRows = [
    ["Dimensions", product.specs.dimensions],
    ["Contenance", product.specs.capacity],
    ["Matière", product.specs.material],
    ["Contenu du pack", product.specs.packContents],
  ] as const;

  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-10">
      <Kicker>Démonstration</Kicker>
      <h1 className="mt-2 text-2xl font-semibold leading-tight">
        Un kit complet pour un sérum vitamine C 30 ml
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        Marché visé : Côte d&apos;Ivoire. Produit non détenu — planche bâtie sur des visuels
        fournisseur. Toutes les données ci-dessous sont un exemple réel de sortie.
      </p>

      <nav className="sticky top-0 z-10 -mx-5 mt-6 border-y border-stone-200 bg-stone-50/95 px-5 py-2 backdrop-blur">
        <ul className="flex gap-4 text-xs font-medium text-stone-600">
          <li><a href="#matiere" className="hover:text-stone-900">Matière</a></li>
          <li><a href="#argumentaire" className="hover:text-stone-900">Argumentaire</a></li>
          <li><a href="#production" className="hover:text-stone-900">Production</a></li>
        </ul>
      </nav>

      {/* ── R1 ───────────────────────────────────────────────────────────── */}
      <section id="matiere" className="mt-8 space-y-4">
        <SectionTitle
          step="Montrer · R1"
          title="Kit matière"
          subtitle="La base factuelle et la planche visuelle. Rien n'est utilisé en aval tant que cette planche n'est pas validée."
        />

        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-semibold tabular-nums">{product.fidelity.score}</p>
              <p className="text-xs text-stone-500">Score de fidélité / 100</p>
            </div>
            <Badge tone={product.fidelity.gatePassed ? "ok" : "risk"}>
              {product.fidelity.gatePassed ? "Planche validée" : "Planche refusée"}
            </Badge>
          </div>

          <div className="mt-4 space-y-2.5">
            <ScoreBar label="Couverture des vues" value={product.fidelity.breakdown.coverage} max={30} />
            <ScoreBar label="Résolution" value={product.fidelity.breakdown.resolution} max={20} />
            <ScoreBar label="Cohérence inter-vues" value={product.fidelity.breakdown.consistency} max={15} />
            <ScoreBar label="Lisibilité du label" value={product.fidelity.breakdown.text} max={15} />
            <ScoreBar label="Sources distinctes" value={product.fidelity.breakdown.consensus} max={20} />
          </div>

          <p className="mt-4 border-t border-stone-100 pt-3 text-xs leading-relaxed text-stone-500">
            {product.evidence.consensusNote}
          </p>
        </Card>

        <div>
          <Kicker>Vues couvertes · 5 / 5</Kicker>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {product.images.map((image) => (
              <figure key={image.id} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200">
                  <span className="px-1 text-center text-[10px] font-medium uppercase tracking-wide text-stone-500">
                    {image.slot.replace("-", " ")}
                  </span>
                </div>
                <figcaption className="px-2 py-1.5">
                  <span className="text-[10px] text-stone-500">
                    {PROVENANCE_LABEL[image.provenance] ?? image.provenance}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>

        <Card>
          <Kicker>Specs corroborées</Kicker>
          <dl className="mt-2 divide-y divide-stone-100 text-sm">
            {specRows.map(([label, spec]) =>
              spec ? (
                <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-stone-500">{label}</dt>
                  <dd className="text-right">
                    <span className="block">{spec.value}</span>
                    <Badge
                      tone={spec.confidence === "high" ? "ok" : spec.confidence === "medium" ? "info" : "warn"}
                      className="mt-1"
                    >
                      {spec.sources.length} source{spec.sources.length > 1 ? "s" : ""}
                    </Badge>
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
          <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-amber-800">
            ⚠ {product.evidence.conflicts[0]}
          </p>
        </Card>

        <Card>
          <Kicker>Allégations</Kicker>
          <ul className="mt-2 space-y-2 text-sm">
            {product.claims.map((claim) => (
              <li key={claim.text} className="flex items-start justify-between gap-3">
                <span>{claim.text}</span>
                {claim.source ? (
                  <Badge tone="info">sourcé</Badge>
                ) : (
                  <Badge tone="warn">hypothèse</Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-stone-500">
            Une allégation non sourcée ne peut sortir que marquée comme hypothèse — jamais
            présentée comme un fait.
          </p>
        </Card>
      </section>

      {/* ── R2 ───────────────────────────────────────────────────────────── */}
      <section id="argumentaire" className="mt-10 space-y-4">
        <SectionTitle
          step="Convaincre · R2"
          title="Kit argumentaire"
          subtitle="Ce qui fait acheter, ce qui bloque, et ce que dit la concurrence. La carte de saturation est un instrument interne : ce qui sort, c'est un portefeuille d'angles priorisé."
        />

        <Card className="bg-stone-900 text-white">
          <div className="flex items-center justify-between">
            <Kicker>Échantillon</Kicker>
            <Badge tone="warn">{market.dataQuality.confidence}</Badge>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {market.dataQuality.adsFound} annonces analysées
          </p>
          <p className="mt-2 text-xs leading-relaxed text-stone-400">
            Échantillon, pas recensement. {market.dataQuality.gaps[0]}
          </p>
        </Card>

        <div className="space-y-3">
          <Kicker>Portefeuille d&apos;angles</Kicker>
          {market.anglePortfolio.map((angle) => {
            const status = STATUS[angle.status] ?? { label: angle.status, tone: "muted" as Tone };
            return (
              <Card key={angle.angleFamily}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold capitalize">{angle.angleFamily.replace("-", " ")}</h3>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <p className="mt-1 text-xs font-medium text-stone-700">{ACTION[angle.status]}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500">
                  <span>{angle.advertisersCount} annonceur{angle.advertisersCount > 1 ? "s" : ""}</span>
                  <span>{Math.round(angle.medianDaysRunning)} j de diffusion médiane</span>
                  {angle.markets.length > 0 && <span>{angle.markets.join(", ")}</span>}
                </div>
                {angle.evidenceUrls[0] && (
                  <div className="mt-2">
                    <SourceLink url={angle.evidenceUrls[0]} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <Card className="border-emerald-200 bg-emerald-50/60">
          <Kicker>Espace blanc importé</Kicker>
          <p className="mt-1 text-sm font-semibold capitalize">
            {market.whiteSpaceImported[0]?.angle}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">
            Prouvé sur {market.whiteSpaceImported[0]?.sourceMarket}.{" "}
            {market.whiteSpaceImported[0]?.whyTransferable}
          </p>
          <p className="mt-2 text-[11px] text-emerald-900">
            Ce n&apos;est pas une invention : c&apos;est une preuve décalée dans le temps.
          </p>
        </Card>

        <div>
          <Kicker>Objections réelles</Kicker>
          <div className="mt-2 space-y-2">
            {market.objections.map((objection) => (
              <Card key={objection.objection}>
                <p className="text-sm">{objection.objection}</p>
                <p className="mt-2 text-xs leading-relaxed text-stone-600">
                  <span className="font-medium text-stone-800">Réponse : </span>
                  {objection.counterAngle}
                </p>
                {objection.evidence[0] && (
                  <div className="mt-2">
                    <SourceLink url={objection.evidence[0].url} />
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>

        <Card>
          <Kicker>Verbatims clients</Kicker>
          {market.personas[0]?.verbatims.map((v) => (
            <blockquote key={v.quote} className="mt-3 border-l-2 border-stone-300 pl-3 text-sm italic text-stone-700">
              « {v.quote} »
              <footer className="mt-1 not-italic">
                <SourceLink url={v.sourceUrl} />
              </footer>
            </blockquote>
          ))}
          <p className="mt-3 text-[11px] leading-relaxed text-stone-500">
            Jamais reformulés : c&apos;est le langage du client qui fait convertir, pas celui de
            l&apos;agence.
          </p>
        </Card>

        {market.riskFlags.map((flag) => (
          <Card key={flag.note} className="border-red-200 bg-red-50/60">
            <div className="flex items-center justify-between">
              <Kicker>Risque</Kicker>
              <Badge tone="risk">{flag.type === "meta_policy" ? "Refus pub Meta" : flag.type}</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-stone-800">{flag.note}</p>
          </Card>
        ))}
      </section>

      {/* ── R3 ───────────────────────────────────────────────────────────── */}
      <section id="production" className="mt-10 space-y-4">
        <SectionTitle
          step="Produire · R3"
          title="Kit production"
          subtitle="Angles, hooks, scripts verticaux et prompts d'image. Chaque angle renvoie à un angle prouvé du kit argumentaire — rien n'est inventé ici."
        />

        <Card className="bg-stone-900 text-white">
          <Kicker>Big idea</Kicker>
          <p className="mt-1 text-[15px] leading-relaxed">{creative.bigIdea}</p>
        </Card>

        <div className="space-y-3">
          {creative.angles.map((angle) => (
            <Card key={angle.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">« {angle.hook} »</p>
                <Badge tone="info">niv. {angle.awarenessLevel}</Badge>
              </div>
              <dl className="mt-2 space-y-1.5 text-xs leading-relaxed">
                {[
                  ["Insight", angle.insight],
                  ["Promesse", angle.promise],
                  ["Mécanisme", angle.mechanism],
                  ["Preuve", angle.proof],
                  ["Objection traitée", angle.objectionHandled],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-stone-400">{label as string}</dt>
                    <dd className="text-stone-700">{value as string}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2">
                <Badge tone="muted">source : {angle.sourceAngleRef}</Badge>
              </div>
            </Card>
          ))}
        </div>

        <Card>
          <Kicker>Script 15 s · hook dans les 2 premières secondes</Kicker>
          <ol className="mt-3 space-y-3">
            {creative.scripts[0]?.scenes.map((scene) => (
              <li key={scene.atS} className="flex gap-3">
                <span className="w-10 shrink-0 text-[11px] tabular-nums text-stone-400">
                  {scene.atS}s
                </span>
                <div>
                  <p className="text-sm">{scene.visual}</p>
                  {scene.voiceover && (
                    <p className="text-xs italic text-stone-500">{scene.voiceover}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <Kicker>Direction visuelle</Kicker>
          <div className="mt-2 flex gap-2">
            {creative.visualDirection.palette.map((hex) => (
              <span
                key={hex}
                className="h-8 w-8 rounded-lg ring-1 ring-inset ring-stone-200"
                style={{ backgroundColor: hex }}
                title={hex}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-medium text-emerald-800">À faire</p>
              <ul className="mt-1 space-y-1 text-stone-600">
                {creative.visualDirection.do.map((d) => <li key={d}>· {d}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-medium text-red-800">À éviter</p>
              <ul className="mt-1 space-y-1 text-stone-600">
                {creative.visualDirection.dont.map((d) => <li key={d}>· {d}</li>)}
              </ul>
            </div>
          </div>
        </Card>

        <Card>
          <Kicker>Prompt d&apos;image</Kicker>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-stone-900 p-3 text-[11px] leading-relaxed text-stone-100">
{creative.imagePrompts[0]?.prompt}
          </pre>
        </Card>
      </section>

      <div className="mt-12 border-t border-stone-200 pt-6">
        <p className="text-xs leading-relaxed text-stone-500">
          Cet exemple est généré à partir des mêmes contrats que la production. Les données
          sont figées pour la démonstration ; en usage réel, chaque sortie est sourcée et
          rejetée si elle ne respecte pas le contrat.
        </p>
        <Link
          href="/wallet"
          className="mt-4 block rounded-2xl bg-stone-900 px-5 py-4 text-center text-[15px] font-medium text-white"
        >
          Recharger et analyser mon produit
        </Link>
      </div>
    </main>
  );
}
