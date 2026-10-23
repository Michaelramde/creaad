/**
 * Vérification des webhooks GeniusPay.
 *
 * Format documenté : signature = HMAC_SHA256(timestamp + "." + body_brut, secret)
 * En-têtes : X-Webhook-Signature, X-Webhook-Timestamp, X-Webhook-Event
 *
 * ⚠️ Le corps DOIT être le texte brut reçu, avant tout JSON.parse.
 * Re-sérialiser l'objet casse la signature.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "missing_secret" | "bad_signature" | "stale_timestamp" };

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyWebhookSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string | undefined;
  nowSeconds?: number;
}): VerifyResult {
  const { rawBody, timestamp, signature, secret } = input;

  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!secret) return { ok: false, reason: "missing_secret" };

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  if (!safeEqualHex(expected, signature)) return { ok: false, reason: "bad_signature" };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  return { ok: true };
}

export interface WebhookPayload {
  id: string;
  event: string;
  timestamp: number;
  created_at?: string;
  data: {
    object: string;
    id: number;
    reference: string;
    amount: number;
    currency: string;
    fees?: number;
    net_amount?: number;
    status: string;
    payment_method?: string;
    provider?: string;
    customer_name?: string;
    customer_phone?: string;
    merchant_id?: number;
    metadata?: Record<string, string>;
  };
  environment: "sandbox" | "live";
  api_version?: string;
}

export function parseWebhook(rawBody: string): WebhookPayload {
  return JSON.parse(rawBody) as WebhookPayload;
}
