/**
 * Point d'entrée des contrats : validation + vérifications croisées.
 *
 * Un kit n'est jamais « réparé ». S'il ne passe pas, il est rejeté avec la
 * liste précise des manquements — le repasseur doit savoir quoi corriger.
 */
import { z } from "zod";

import {
  creativeKitSchema,
  marketKitSchema,
  productKitSchema,
  type CreativeKit,
  type MarketKit,
  type ProductKit,
} from "./kits.ts";

export type { CreativeKit, MarketKit, ProductKit };
export { creativeKitSchema, marketKitSchema, productKitSchema };

export class ContractError extends Error {
  readonly issues: string[];

  constructor(kit: string, issues: string[]) {
    super(`Contrat ${kit} invalide :\n- ${issues.join("\n- ")}`);
    this.name = "ContractError";
    this.issues = issues;
  }
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join(".") : "(racine)";
    return `${path} : ${i.message}`;
  });
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, name: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ContractError(name, formatIssues(result.error));
  return result.data;
}

export function parseProductKit(raw: unknown): ProductKit {
  return parseOrThrow(productKitSchema, raw, "R1 — kit matière");
}

export function parseMarketKit(raw: unknown): MarketKit {
  return parseOrThrow(marketKitSchema, raw, "R2 — kit argumentaire");
}

/**
 * R3 dépend de R2 : chaque angle créatif doit référencer un angle réellement
 * présent dans le portefeuille. C'est ce qui empêche un modèle d'inventer
 * un angle au moment de la rédaction.
 */
export function parseCreativeKitAgainst(
  raw: unknown,
  allowedFamilies: readonly string[],
): CreativeKit {
  const kit = parseOrThrow(creativeKitSchema, raw, "R3 — kit production");
  const allowed = new Set(allowedFamilies);

  const unknown = kit.angles
    .map((a) => a.sourceAngleRef)
    .filter((ref) => !allowed.has(ref));

  if (unknown.length > 0) {
    throw new ContractError("R3 — kit production", [
      `angles.sourceAngleRef : référence(s) absente(s) du kit argumentaire — ${[...new Set(unknown)].join(", ")}`,
    ]);
  }

  return kit;
}

export function parseCreativeKit(
  raw: unknown,
  options: { market?: MarketKit } = {},
): CreativeKit {
  const kit = parseOrThrow(creativeKitSchema, raw, "R3 — kit production");

  if (!options.market) return kit;

  const known = new Set<string>([
    ...options.market.anglePortfolio.map((a) => a.angleFamily),
    ...options.market.whiteSpaceImported.map((w) => w.angle),
    "non-classe",
  ]);

  const unknown = kit.angles
    .map((a) => a.sourceAngleRef)
    .filter((ref) => !known.has(ref));

  if (unknown.length > 0) {
    throw new ContractError("R3 — kit production", [
      `angles.sourceAngleRef : référence(s) absente(s) du kit argumentaire — ${[...new Set(unknown)].join(", ")}`,
    ]);
  }

  return kit;
}

/** Résumé lisible pour l'UI ou les logs. */
export function contractSummary(kit: ProductKit | MarketKit | CreativeKit): string {
  if ("fidelity" in kit) {
    return `R1 · ${kit.identity.archetype} · ${kit.fidelity.score}/100 · ${kit.images.length} visuels`;
  }
  if ("anglePortfolio" in kit) {
    return `R2 · ${kit.market.country} · ${kit.dataQuality.adsFound} annonces · ${kit.anglePortfolio.length} angles`;
  }
  return `R3 · ${kit.angles.length} angles · ${kit.hooks.length} hooks · ${kit.scripts.length} scripts`;
}
