/**
 * Fournisseurs Alibaba / 1688 — la troisième source de corroboration.
 *
 * Une fiche AliExpress dit « 30 ml ». Une usine Alibaba qui fabrique le même
 * design le dit aussi ? Alors on peut l'affirmer. C'est la seule source qui
 * apporte une **indépendance réelle** : elle ne recopie pas la fiche.
 */
import { checkBudget } from "../costs.ts";
import { factsFromProduct } from "../products/parse-facts.ts";
import type { RawFacts } from "../products/corroborate.ts";
import type { ApifyClient } from "./apify.ts";

interface RawSupplier {
  site?: string;
  productId?: string;
  title?: string;
  price?: number;
  currency?: string;
  minOrderQty?: string;
  productUrl?: string;
  supplierName?: string;
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
   * Cherche le même design chez les fabricants, puis résume leurs faits.
   * Une seule valeur par champ est retenue : celle qui revient le plus.
   */
  async find(
    imageUrl: string,
    options: { analysisId?: string; maxResults?: number } = {},
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
      { imageUrl, maxResults: options.maxResults ?? 30 },
      { step: "suppliers", ...(options.analysisId ? { analysisId: options.analysisId } : {}) },
    );

    const listings: SupplierListing[] = [];
    const tally = new Map<string, Map<string, number>>();

    for (const item of run.items) {
      if (!item.title) continue;

      const facts = factsFromProduct({ title: item.title, specs: {} });
      listings.push({
        site: item.site ?? "alibaba",
        title: item.title,
        ...(typeof item.price === "number" ? { price: item.price } : {}),
        ...(item.currency ? { currency: item.currency } : {}),
        ...(item.minOrderQty ? { minOrderQty: item.minOrderQty } : {}),
        ...(item.productUrl ? { url: item.productUrl } : {}),
        ...(item.supplierName ? { supplier: item.supplierName } : {}),
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
