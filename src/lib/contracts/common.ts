/**
 * Primitives partagées par les trois contrats de kits.
 *
 * Objectif : rendre impossible la sortie d'un rapport non sourcé.
 * Toute affirmation est soit liée à une source, soit explicitement marquée
 * comme hypothèse. Il n'existe pas de troisième voie.
 */
import { z } from "zod";

export const PROVENANCES = [
  "utilisateur",
  "fournisseur",
  "marchand",
  "concurrent",
  "generee",
] as const;

export const CATEGORIES = ["beaute", "cheveux", "mode", "gadgets"] as const;

export const CONFIDENCES = ["insufficient", "none", "low", "medium", "high"] as const;

export const PLATFORMS = [
  "meta",
  "tiktok",
  "jumia",
  "aliexpress",
  "amazon",
  "reddit",
  "youtube",
  "site",
  "autre",
] as const;

/** Date ISO-8601, validée sans dépendre d'un helper de version. */
export const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Date ISO invalide" });

export const sourceRef = z.object({
  url: z.url(),
  platform: z.enum(PLATFORMS),
  observedAt: isoDate.optional(),
  label: z.string().max(200).optional(),
});

export type SourceRef = z.infer<typeof sourceRef>;

/** Une affirmation porte toujours une source ou un statut d'hypothèse. */
export const claim = z
  .object({
    text: z.string().min(3).max(500),
    source: sourceRef.optional(),
    /** `true` si la source a été vérifiée à la main. */
    verified: z.boolean().default(false),
    /** Marque explicitement une hypothèse non sourcée. */
    hypothesis: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.source && !value.hypothesis) {
      ctx.addIssue({
        code: "custom",
        message: "Une affirmation doit porter une source ou être marquée `hypothesis`.",
        path: ["source"],
      });
    }
  });

export type Claim = z.infer<typeof claim>;

export const confidence = z.enum(CONFIDENCES);

export const slug = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug attendu : minuscules, chiffres, tirets");
