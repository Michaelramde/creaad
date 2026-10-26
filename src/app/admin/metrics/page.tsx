import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Kicker } from "@/components/ui";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  getArchetypeCoverage,
  getBlockedReasons,
  getCostByStep,
  getCostPerDelivery,
  getFunnel,
  getMatchDistribution,
  getUncoveredAnalyses,
  XOF_PER_USD,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * Le tableau de bord qui manquait.
 *
 * Il répond à la seule question qui décide de la survie du produit :
 * **quel pourcentage des analyses livre réellement ?** Tout le reste
 * (coûts, couverture, matching) sert à expliquer ce chiffre.
 *
 * Fermé par défaut : sans ADMIN_EMAILS, la page est un 404 — pas un 403,
 * pour ne pas révéler son existence.
 */
const THRESHOLD = 30;

const fmtUsd = (n: number) => `${n.toFixed(5)} $`;
const fmtPct = (n: number) => `${n.toFixed(1)} %`;

export default async function MetricsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const admins = env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = session?.user.email?.toLowerCase() ?? "";
  if (!session || admins.length === 0 || !admins.includes(email)) notFound();

  const [funnel, costs, delivery, coverage, uncovered, match, blocked] = await Promise.all([
    getFunnel(),
    getCostByStep(30),
    getCostPerDelivery(30),
    getArchetypeCoverage(50),
    getUncoveredAnalyses(15),
    getMatchDistribution(),
    getBlockedReasons(8),
  ]);

  const verdict =
    funnel.total === 0
      ? "Aucune analyse en base : rien à conclure."
      : funnel.deliveryRate >= 60
        ? "Le produit livre. On peut construire."
        : funnel.deliveryRate >= THRESHOLD
          ? "Le produit livre parfois. La clé de jointure archétype devient prioritaire."
          : "Portillon atteint : on ne construit plus rien avant d'avoir compris pourquoi.";

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20 pt-10">
      <Kicker>Interne · pilotage</Kicker>
      <h1 className="mt-1 text-xl font-semibold">Métriques</h1>

      {/* Le chiffre qui commande tout le reste */}
      <section className="mt-4 rounded-2xl bg-stone-900 p-5 text-white">
        <p className="text-xs uppercase tracking-[0.18em] text-stone-400">
          Taux de livraison ({funnel.delivered}/{funnel.delivered + funnel.blocked + funnel.refused + funnel.failed} terminées)
        </p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">{fmtPct(funnel.deliveryRate)}</p>
        <p className="mt-2 text-sm leading-relaxed text-stone-300">{verdict}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-stone-400">
          Dossiers d&apos;étape 1 délivrés : {fmtPct(funnel.dossierRate)} ({funnel.dossiers} — un dossier
          livré n&apos;est pas un kit complet, mais ce n&apos;est pas un remboursement).
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-stone-400">Bloqués article</dt>
            <dd className="text-base font-medium tabular-nums">{fmtPct(funnel.blockRate)}</dd>
          </div>
          <div>
            <dt className="text-stone-400">Planche refusée</dt>
            <dd className="text-base font-medium tabular-nums">{fmtPct(funnel.refusalRate)}</dd>
          </div>
          <div>
            <dt className="text-stone-400">Échecs techniques</dt>
            <dd className="text-base font-medium tabular-nums">{fmtPct(funnel.failureRate)}</dd>
          </div>
          <div>
            <dt className="text-stone-400">En vol</dt>
            <dd className="text-base font-medium tabular-nums">{funnel.inFlight}</dd>
          </div>
        </dl>
      </section>

      {/* Coût */}
      <Section title="Coût par livraison" note={`1 $ = ${XOF_PER_USD} FCFA (indicatif)`}>
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{delivery.perDeliveryXof} FCFA</span>
          <span className="ml-2 text-xs text-stone-500">
            ({fmtUsd(delivery.perDeliveryUsd)} sur {delivery.delivered} livraison(s))
          </span>
        </p>
        {delivery.hasEstimates && (
          <p className="mt-1 text-[11px] text-amber-700">
            Contient des lignes estimées (facturation fournisseur non lue).
          </p>
        )}
        <table className="mt-3 w-full text-left text-[11px]">
          <thead className="text-stone-400">
            <tr>
              <th className="py-1">Étape</th>
              <th>Fournisseur</th>
              <th className="text-right">Appels</th>
              <th className="text-right">Moyen</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {costs.length === 0 && (
              <tr><td colSpan={5} className="py-2 text-stone-500">Aucun coût enregistré.</td></tr>
            )}
            {costs.map((row) => (
              <tr key={`${row.step}|${row.provider}`} className="border-t border-stone-100">
                <td className="py-1">{row.step}</td>
                <td className="text-stone-500">{row.provider ?? "—"}</td>
                <td className="text-right tabular-nums">{row.calls}</td>
                <td className="text-right tabular-nums">{fmtUsd(row.avgUsd)}</td>
                <td className="text-right tabular-nums">{fmtUsd(row.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Matching : les seuils sont-ils calibrés ? */}
      <Section title="Distribution du score d'appariement" note="sert à recalibrer 70 / 0,45 / 0,85">
        <table className="w-full text-left text-[11px]">
          <tbody>
            {match.map((row) => (
              <tr key={row.bucket} className="border-t border-stone-100">
                <td className="py-1">{row.bucket}</td>
                <td className="text-right tabular-nums">{row.analyses}</td>
                <td className="text-right tabular-nums text-stone-500">moy. {row.avgScore}</td>
              </tr>
            ))}
            {match.length === 0 && <tr><td className="py-2 text-stone-500">Aucun score enregistré.</td></tr>}
          </tbody>
        </table>
      </Section>

      {/* Motifs d'échec */}
      <Section title="Pourquoi ça bloque" note="les 8 motifs les plus fréquents">
        <ul className="space-y-1 text-[11px]">
          {blocked.map((row) => (
            <li key={row.code} className="flex justify-between border-t border-stone-100 py-1">
              <span className="font-mono">{row.code}</span>
              <span className="tabular-nums">{row.count}</span>
            </li>
          ))}
          {blocked.length === 0 && <li className="py-2 text-stone-500">Aucun échec enregistré.</li>}
        </ul>
      </Section>

      {/* Couverture du catalogue */}
      <Section title="Couverture des archétypes" note="un archétype sans annonce ne peut rien vendre">
        <table className="w-full text-left text-[11px]">
          <thead className="text-stone-400">
            <tr><th className="py-1">Archétype</th><th className="text-right">Annonces</th><th className="text-right">Annonceurs</th></tr>
          </thead>
          <tbody>
            {coverage.map((row) => (
              <tr key={row.slug} className={row.ads === 0 ? "border-t border-stone-100 text-amber-700" : "border-t border-stone-100"}>
                <td className="py-1 font-mono">{row.slug}</td>
                <td className="text-right tabular-nums">{row.ads}</td>
                <td className="text-right tabular-nums">{row.advertisers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Le trou de couverture, côté client */}
      <Section title="Analyses sans marché" note="archétype non routé ou sans annonce">
        <ul className="space-y-1 text-[11px]">
          {uncovered.map((row) => (
            <li key={row.id} className="flex justify-between border-t border-stone-100 py-1">
              <span className="font-mono">{row.archetypeSlug ?? "(non routé)"}</span>
              <span className="text-stone-500">{row.status}</span>
            </li>
          ))}
          {uncovered.length === 0 && <li className="py-2 text-stone-500">Toutes les analyses ont un marché.</li>}
        </ul>
      </Section>

      <p className="mt-8 text-[11px] leading-relaxed text-stone-400">
        Les mêmes agrégats sont exposés en SQL par les vues <code>v_funnel</code>,
        <code>v_costs</code> et <code>v_cost_per_delivery</code> (migration 0017) pour le runbook.
      </p>
    </main>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-[11px] text-stone-500">{note}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}
