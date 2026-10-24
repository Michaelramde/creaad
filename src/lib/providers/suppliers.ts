/**
 * Fournisseurs 1688 / Alibaba — la troisième source de corroboration.
 *
 * Acteur retenu après comparaison mesurée : `zen-studio/1688-wholesale-scraper`
 * (159 k exécutions, 911 actifs sur 7 jours, 99,3 % de succès, 5,0/5) coûte
 * **0,0049 $** pour 20 fiches — contre **0,101 $** pour l'acteur de recherche
 * par image, soit 20 fois plus cher pour la même information.
 *
 * Réserve honnête : les titres 1688 sont en chinois. Les **dimensions** restent
 * exploitables (chiffres et unités), mais la matière ou la marque en français
 * ne peuvent pas être corroborées par cette source.
 */
import { checkBudget } from "../costs.ts";
import { factsFromProduct } from "../products/parse-facts.ts";
import type { RawFacts } from "../products/corroborate.ts";
import type { ApifyClient } from "./apify.ts";

interface RawSupplier {
  offerId?: string;
  title?: string;
  detailUrl?: string;
  price?: { min?: number; max?: number; currency?: string };
  quantityPrices?: unknown;
  images?: string[];
  province?: string;
  city?: string;
  orderCount?: number;
}

export interface SupplierListing {
  site: string;
  title: string;
  price?: number;
  currency?: string;
  minOrderQty?: string;
  url?: string;
  supplier?: string;
  facts: RawFacts;
}

export interface SupplierOutcome {
  listings: SupplierListing[];
  facts: RawFacts;
  costUsd: number;
  warning?: string;
}

export class ApifySuppliers {
  readonly name = "apify-suppliers";
  private readonly client: ApifyClient;
  private readonly actorId: string;

  constructor(client: ApifyClient, actorId: string) {
    this.client = client;
    this.actorId = actorId;
  }

  /**
   * Cherche le même design chez les fabricants, à partir du **titre** du
   * produit (l'acteur travaille par mots-clés, pas par image).
   * Une seule valeur par champ est retenue : celle qui revient le plus.
   */
  async find(
    query: string,
    options: { analysisId?: string } = {},
  ): Promise<SupplierOutcome> {
    const budget = await checkBudget();
    if (!budget.allowed) {
      return {
        listings: [],
        facts: {},
        costUsd: 0,
        warning: `Plafond Apify atteint (${budget.spentUsd.toFixed(2)} $ sur 24 h) — corroboration fournisseur ignorée.`,
      };
    }

    const run = await this.client.run<RawSupplier>(
      this.actorId,
      { queries: [query] },
      { step: "suppliers", ...(options.analysisId ? { analysisId: options.analysisId } : {}) },
    );

    const listings: SupplierListing[] = [];
    const tally = new Map<string, Map<string, number>>();

    for (const item of run.items) {
      if (!item.title) continue;

      const facts = factsFromProduct({ title: item.title, specs: {} });
      listings.push({
        site: "1688",
        title: item.title,
        ...(typeof item.price?.min === "number" ? { price: item.price.min } : {}),
        ...(item.price?.currency ? { currency: item.price.currency } : {}),
        ...(item.detailUrl ? { url: item.detailUrl } : {}),
        facts,
      });

      for (const [field, value] of Object.entries(facts)) {
        const key = JSON.stringify(value);
        const counts = tally.get(field) ?? new Map<string, number>();
        counts.set(key, (counts.get(key) ?? 0) + 1);
        tally.set(field, counts);
      }
    }

    // Fait majoritaire : c'est lui qui part en corroboration.
    const facts: RawFacts = {};
    for (const [field, counts] of tally) {
      const [bestKey, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number];
      // Ignoré si les fabricants ne s'accordent pas entre eux.
      if (count >= 2) facts[field] = JSON.parse(bestKey) as string | number | number[];
    }

    return { listings, facts, costUsd: run.costUsd };
  }
}
