/**
 * Les trois contrats de kits (SPEC §9, §10, §11).
 *
 * Ils sont stricts par construction : un rapport incomplet, non sourcé ou
 * incohérent est **rejeté**, pas corrigé silencieusement. C'est la barrière
 * entre « un modèle a répondu » et « un livrable est publiable ».
 */
import { z } from "zod";

import { CATEGORIES, claim, confidence, isoDate, slug, sourceRef } from "./common.ts";

/* ═══════════════════════════════════════════════════════════════════════════
   R1 — KIT MATIÈRE
   ═══════════════════════════════════════════════════════════════════════════ */

export const planImageSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  slot: z.string().min(1),
  angle: z.string().optional(),
  provenance: z.enum(["utilisateur", "fournisseur", "marchand", "concurrent", "generee"]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  hasWatermark: z.boolean().default(false),
  isDistinctSource: z.boolean().default(true),
  sourceUrl: z.url().optional(),
});

const specValue = z.object({
  value: z.string().min(1),
  sources: z.array(sourceRef).min(1),
  confidence,
});

export const productKitSchema = z
  .object({
    source: z.object({
      listingUrl: z.url(),
      title: z.string().min(1).max(300),
      supplierSku: z.string().max(120).optional(),
      matchScore: z.number().min(0).max(100),
      variant: z.string().max(120).optional(),
    }),
    identity: z.object({
      archetype: slug,
      brand: z.string().max(120).optional(),
      model: z.string().max(120).optional(),
      category: z.enum(CATEGORIES),
      subcategory: z.string().max(120).optional(),
    }),
    specs: z.object({
      dimensions: specValue.optional(),
      weight: specValue.optional(),
      material: specValue.optional(),
      capacity: specValue.optional(),
      packContents: specValue.optional(),
    }),
    claims: z.array(claim).default([]),
    labelOcr: z.object({
      raw: z.string(),
      corrected: z.string(),
      fields: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
    }),
    variant: z.object({
      colorName: z.string().optional(),
      colorHex: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB")
        .optional(),
      size: z.string().optional(),
      capacity: z.string().optional(),
    }),
    images: z.array(planImageSchema).min(1),
    coverage: z.object({
      requiredSlots: z.array(z.string()).min(1),
      filled: z.array(z.string()),
      missing: z.array(z.string()),
    }),
    fidelity: z.object({
      score: z.number().min(0).max(100),
      breakdown: z.object({
        resolution: z.number().min(0),
        coverage: z.number().min(0),
        consistency: z.number().min(0),
        text: z.number().min(0),
        consensus: z.number().min(0),
      }),
      gatePassed: z.boolean(),
    }),
    evidence: z.object({
      sources: z.array(sourceRef).min(1),
      conflicts: z.array(z.string()).default([]),
      consensusNote: z.string().default(""),
    }),
  })
  .superRefine((kit, ctx) => {
    if (kit.fidelity.gatePassed && kit.fidelity.score < 65) {
      ctx.addIssue({
        code: "custom",
        message: `Planche déclarée valide à ${kit.fidelity.score}/100, sous le seuil de 65.`,
        path: ["fidelity", "gatePassed"],
      });
    }
    if (kit.fidelity.gatePassed && kit.coverage.missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Planche valide alors que ${kit.coverage.missing.length} slot(s) sont manquants : ${kit.coverage.missing.join(", ")}.`,
        path: ["coverage", "missing"],
      });
    }
    const filledSet = new Set(kit.coverage.filled);
    for (const image of kit.images) {
      if (!kit.coverage.requiredSlots.includes(image.slot)) {
        ctx.addIssue({
          code: "custom",
          message: `L'image ${image.id} occupe un slot non requis : ${image.slot}.`,
          path: ["images", image.id],
        });
      }
      if (!filledSet.has(image.slot)) {
        ctx.addIssue({
          code: "custom",
          message: `L'image ${image.id} n'apparaît pas dans \`coverage.filled\`.`,
          path: ["coverage", "filled"],
        });
      }
    }
  });

export type ProductKit = z.infer<typeof productKitSchema>;

/* ═══════════════════════════════════════════════════════════════════════════
   R2 — KIT ARGUMENTAIRE
   ═══════════════════════════════════════════════════════════════════════════ */

export const ANGLE_STATUSES = [
  "proven_here",
  "proven_elsewhere",
  "rising",
  "observed_unproven",
  "unobserved",
] as const;

export const anglePortfolioEntrySchema = z
  .object({
    angleFamily: z.string().min(2),
    status: z.enum(ANGLE_STATUSES),
    advertisersCount: z.number().int().min(0),
    medianDaysRunning: z.number().min(0),
    markets: z.array(z.string()).default([]),
    evidenceUrls: z.array(z.url()).default([]),
    proofAvailable: z.array(z.string()).default([]),
    objectionAddressed: z.string().max(300).optional(),
    priority: z.number(),
  })
  .superRefine((entry, ctx) => {
    // Aucun angle sans source — sauf s'il est explicitement inconnu.
    if (entry.status !== "unobserved" && entry.evidenceUrls.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `Angle « ${entry.angleFamily} » au statut ${entry.status} sans URL source.`,
        path: ["evidenceUrls"],
      });
    }
    if (entry.status === "proven_here" && entry.advertisersCount < 3) {
      ctx.addIssue({
        code: "custom",
        message: `« ${entry.angleFamily} » déclaré prouvé ici avec ${entry.advertisersCount} annonceur(s) : minimum 3.`,
        path: ["advertisersCount"],
      });
    }
    if (
      (entry.status === "proven_here" || entry.status === "proven_elsewhere") &&
      entry.medianDaysRunning <= 45
    ) {
      ctx.addIssue({
        code: "custom",
        message: `« ${entry.angleFamily} » déclaré prouvé avec ${entry.medianDaysRunning} j de diffusion médiane : minimum 45.`,
        path: ["medianDaysRunning"],
      });
    }
    if (entry.status === "proven_elsewhere" && entry.markets.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `« ${entry.angleFamily} » importé sans préciser le marché source.`,
        path: ["markets"],
      });
    }
  });

export const marketKitSchema = z
  .object({
    market: z.object({
      country: z.string().length(2),
      language: z.string().min(2).max(5),
      currency: z.string().min(3).max(3),
      maturityStage: z.enum(["emerging", "growing", "mature"]),
    }),
    personas: z
      .array(
        z.object({
          name: z.string().min(2).max(80),
          profile: z.string().min(10).max(800),
          verbatims: z
            .array(
              z.object({
                quote: z.string().min(3).max(400),
                sourceUrl: z.url(),
                platform: z.enum(["meta", "tiktok", "jumia", "amazon", "reddit", "youtube", "site", "autre"]),
              }),
            )
            .default([]),
        }),
      )
      .default([]),
    desires: z
      .array(
        z.object({
          level: z.number().int().min(1).max(5),
          statement: z.string().min(5).max(300),
          evidence: z.array(sourceRef).min(1),
        }),
      )
      .default([]),
    objections: z
      .array(
        z.object({
          objection: z.string().min(5).max(300),
          frequency: z.number().min(0).max(1).optional(),
          evidence: z.array(sourceRef).min(1),
          counterAngle: z.string().min(5).max(300),
        }),
      )
      .default([]),
    competitors: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          platform: z.string().min(2).max(40),
          url: z.url(),
          offer: z.string().max(200).optional(),
          price: z.string().max(60).optional(),
          promise: z.string().max(300).optional(),
          ads: z
            .array(
              z.object({
                hook: z.string().max(300),
                startDate: isoDate,
                daysRunning: z.number().min(0),
                url: z.url(),
              }),
            )
            .default([]),
        }),
      )
      .default([]),
    anglePortfolio: z.array(anglePortfolioEntrySchema).default([]),
    whiteSpaceImported: z
      .array(
        z.object({
          angle: z.string().min(2),
          sourceMarket: z.string().min(2),
          whyTransferable: z.string().min(10).max(500),
        }),
      )
      .default([]),
    riskFlags: z
      .array(
        z.object({
          type: z.enum(["meta_policy", "legal", "category"]),
          severity: z.enum(["info", "warning", "blocking"]),
          note: z.string().min(10).max(500),
        }),
      )
      .default([]),
    dataQuality: z.object({
      adsFound: z.number().int().min(0),
      confidence,
      gaps: z.array(z.string()).default([]),
    }),
  })
  .superRefine((kit, ctx) => {
    // Garde-fou : sous 15 annonces, aucune carte ne doit être publiée.
    if (kit.dataQuality.adsFound < 15 && kit.dataQuality.confidence !== "insufficient") {
      ctx.addIssue({
        code: "custom",
        message: `Échantillon de ${kit.dataQuality.adsFound} annonces déclaré « ${kit.dataQuality.confidence} » : doit être « insufficient » sous 15.`,
        path: ["dataQuality", "confidence"],
      });
    }
    if (kit.dataQuality.confidence === "insufficient" && kit.anglePortfolio.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Données insuffisantes mais un portefeuille d'angles est fourni.",
        path: ["anglePortfolio"],
      });
    }
  });

export type MarketKit = z.infer<typeof marketKitSchema>;

/* ═══════════════════════════════════════════════════════════════════════════
   R3 — KIT PRODUCTION
   ═══════════════════════════════════════════════════════════════════════════ */

export const creativeKitSchema = z
  .object({
    bigIdea: z.string().min(10).max(300),
    angles: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          insight: z.string().min(5).max(300),
          promise: z.string().min(5).max(300),
          mechanism: z.string().min(5).max(300),
          proof: z.string().min(3).max(300),
          objectionHandled: z.string().min(3).max(300),
          hook: z.string().min(5).max(200),
          awarenessLevel: z.number().int().min(1).max(5),
          /** Doit exister dans le portefeuille du kit argumentaire. */
          sourceAngleRef: z.string().min(2),
        }),
      )
      .min(1),
    hooks: z
      .array(
        z.object({
          format: z.enum(["ugc", "static", "voiceover"]),
          text: z.string().min(5).max(160),
          durationS: z.number().min(1).max(15),
          variant: z.string().max(80).optional(),
        }),
      )
      .min(1),
    scripts: z
      .array(
        z.object({
          format: z.enum(["ugc", "static", "voiceover"]),
          durationS: z.number().min(5).max(60),
          /** Le hook doit tenir dans les 2 premières secondes (SPEC §10). */
          hookEndsAtS: z.number().min(0).max(2),
          scenes: z
            .array(
              z.object({
                atS: z.number().min(0),
                visual: z.string().min(3).max(300),
                text: z.string().max(200).optional(),
                voiceover: z.string().max(300).optional(),
              }),
            )
            .min(2),
        }),
      )
      .min(1),
    visualDirection: z.object({
      palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1),
      motifs: z.array(z.string()).default([]),
      do: z.array(z.string()).default([]),
      dont: z.array(z.string()).default([]),
    }),
    imagePrompts: z
      .array(
        z.object({
          slotRef: z.string().min(1),
          scene: z.string().min(5).max(300),
          prompt: z.string().min(10).max(2000),
          negativePrompt: z.string().max(1000).optional(),
          referenceImages: z.array(z.url()).default([]),
        }),
      )
      .default([]),
  })
  .superRefine((kit, ctx) => {
    for (const script of kit.scripts) {
      const first = script.scenes[0];
      if (!first || first.atS !== 0) {
        ctx.addIssue({
          code: "custom",
          message: "Le premier plan d'un script doit démarrer à 0 s.",
          path: ["scripts"],
        });
      }
      if (script.hookEndsAtS > script.durationS) {
        ctx.addIssue({
          code: "custom",
          message: "Le hook ne peut pas se terminer après la fin du script.",
          path: ["scripts"],
        });
      }
    }
    const ids = new Set(kit.angles.map((a) => a.id));
    if (ids.size !== kit.angles.length) {
      ctx.addIssue({
        code: "custom",
        message: "Identifiants d'angles dupliqués.",
        path: ["angles"],
      });
    }
  });

export type CreativeKit = z.infer<typeof creativeKitSchema>;
