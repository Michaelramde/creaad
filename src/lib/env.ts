/**
 * Variables d'environnement — validées au démarrage, jamais lues ailleurs.
 * Toute variable manquante fait échouer le boot plutôt que de produire
 * un comportement silencieusement dégradé.
 */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url().default("http://localhost:3000"),

  BETTER_AUTH_SECRET: z.string().min(16),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Creaad <no-reply@creaad.app>"),
  /**
   * Vérification d'email obligatoire avant connexion.
   * Désactivée par défaut : sans clé Resend, aucun utilisateur ne pourrait
   * entrer. Le wallet reste le vrai verrou (il faut payer pour analyser).
   */
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("creaad"),
  /**
   * Domaine public du bucket (r2.dev ou domaine personnalisé).
   * Sans lui, l'upload présigné est désactivé et les photos repartent en
   * base64 — l'application continue de fonctionner, dégradée mais honnête.
   */
  R2_PUBLIC_URL: z.string().optional(),

  GP_BASE: z.url().default("https://geniuspay.ci/api/v1/merchant"),
  GP_PK: z.string().optional(),
  GP_SK: z.string().optional(),
  GP_WHSEC: z.string().optional(),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  /** Modèle Gemini — surchargeable car Google retire régulièrement les anciens. */
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  /** AliExpress Open Platform — inscription gratuite, API officielle. */
  ALIEXPRESS_APP_KEY: z.string().optional(),
  ALIEXPRESS_APP_SECRET: z.string().optional(),
  ALIEXPRESS_TRACKING_ID: z.string().default("creaad"),
  MISTRAL_API_KEY: z.string().optional(),
  APIFY_TOKEN: z.string().optional(),
  /** Plafond de dépense Apify sur 24 h. 0 = illimité. */
  APIFY_DAILY_CAP_USD: z.coerce.number().min(0).default(1),
  /** Acteurs retenus — surchargeables sans toucher au code. */
  ACTOR_IMAGE_SEARCH: z.string().default("piotrv1001~aliexpress-image-search-scraper"),
  ACTOR_PRODUCT_DETAIL: z.string().default("zen-studio~aliexpress-scraper"),
  ACTOR_SUPPLIERS: z.string().default("zen-studio~1688-wholesale-scraper"),
  ACTOR_META_ADS: z.string().default("jmlp~meta-ad-library-scraper"),

  /** Emails autorisés sur /admin/metrics — liste séparée par des virgules. Vide = page fermée. */
  ADMIN_EMAILS: z.string().default(""),

  CREDIT_XOF: z.coerce.number().int().positive().default(1000),
  /** Étape 2 quand ce marché est déjà calculé : on ne revend pas deux fois la même donnée. */
  CREDIT_XOF_CACHED: z.coerce.number().int().positive().default(500),
  MIN_TOPUP_XOF: z.coerce.number().int().positive().default(5000),
});

const parsed = schema.safeParse({
  ...process.env,
  CREDIT_XOF: process.env.NEXT_PUBLIC_CREDIT_XOF,
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Configuration invalide :\n${issues.join("\n")}`);
}

export const env = parsed.data;

/** Échoue explicitement si une intégration est utilisée sans être configurée. */
export function requireEnv<K extends keyof typeof env>(...keys: K[]): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes : ${missing.join(", ")}`);
  }
}
