import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { parseWebhook, verifyWebhookSignature } from "@/lib/geniuspay/webhook";
import { syncTopup } from "@/lib/payments/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook GeniusPay — seul point d'entrée non authentifié par session.
 *
 *  1. Corps BRUT lu avant tout parsing (sinon la signature casse).
 *  2. Signature HMAC vérifiée + anti-rejeu 5 min.
 *  3. Statut et montant revérifiés par appel API.
 *  4. Crédit idempotent en base.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  const verification = verifyWebhookSignature({
    rawBody,
    timestamp: req.headers.get("x-webhook-timestamp"),
    signature: req.headers.get("x-webhook-signature"),
    secret: env.GP_WHSEC,
  });

  if (!verification.ok) {
    console.warn("[webhook] rejeté :", verification.reason);
    return NextResponse.json({ error: verification.reason }, { status: 401 });
  }

  let payload: ReturnType<typeof parseWebhook>;
  try {
    payload = parseWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: "BAD_PAYLOAD" }, { status: 400 });
  }

  if (payload.event !== "payment.success") {
    return NextResponse.json({ received: true, ignored: payload.event });
  }

  const reference = payload.data.reference;
  if (!reference) {
    return NextResponse.json({ error: "MISSING_REFERENCE" }, { status: 400 });
  }

  try {
    const outcome = await syncTopup(reference);

    if (outcome.result === "amount_mismatch") {
      console.error("[webhook] montant divergent", outcome);
      return NextResponse.json({ error: "AMOUNT_MISMATCH" }, { status: 409 });
    }

    return NextResponse.json({ received: true, outcome: outcome.result });
  } catch (error) {
    console.error("[webhook] échec", error);
    // 500 → GeniusPay rejoue ; l'idempotence rend le rejeu sûr.
    return NextResponse.json({ error: "CREDIT_FAILED" }, { status: 500 });
  }
}
