/**
 * Webhook de bout en bout, contre la PRODUCTION.
 *
 * 1. crée un topup + un paiement sandbox, le complète
 * 2. forge un webhook signé comme GeniusPay le ferait
 * 3. l'envoie à https://creaad.site/api/webhooks/geniuspay
 * 4. vérifie le crédit en base, le rejeu, et le rejet d'une signature invalide
 *
 *   node --env-file=.env.local .tmp/e2e-webhook.mjs
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { topups, user, walletTransactions } from "@/lib/db/schema";
import { initiatePayment } from "@/lib/geniuspay/client";
import { getBalance } from "@/lib/wallet/repo";

const ENDPOINT = "https://creaad.site/api/webhooks/geniuspay";
const SECRET: string = process.env.GP_WHSEC ?? "";
const RUN = Date.now().toString(36);
const USER = `wh-${RUN}`;
const AMOUNT = 5000;

if (!SECRET) throw new Error("GP_WHSEC absent");

async function simulate(reference: string): Promise<string | undefined> {
  const checkoutUrl = `https://geniuspay.ci/checkout/${reference}`;
  const page = await fetch(checkoutUrl, { signal: AbortSignal.timeout(30_000) });
  const html = await page.text();
  const cookies = page.headers.getSetCookie?.() ?? [];
  const csrf = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1];

  const res = await fetch(`${checkoutUrl}/sandbox/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRF-TOKEN": csrf ?? "",
      Cookie: cookies.map((c) => c.split(";")[0]).join("; "),
    },
    body: JSON.stringify({ scenario: "success", gateway: "wave" }),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json()).data?.status;
}

interface WebhookOptions {
  timestamp?: number;
  secret?: string;
  signature?: string;
}

async function sendWebhook(
  payload: { event: string } & Record<string, unknown>,
  options: WebhookOptions = {},
): Promise<{ http: number; body: string }> {
  const raw = JSON.stringify(payload);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const secret = options.secret ?? SECRET;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": options.signature ?? signature,
      "X-Webhook-Timestamp": timestamp,
      "X-Webhook-Event": payload.event,
      "X-Webhook-Environment": "sandbox",
    },
    body: raw,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  return { http: res.status, body: text.slice(0, 200) };
}

async function cleanup() {
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, USER));
  await db.delete(topups).where(eq(topups.userId, USER));
  await db.delete(user).where(eq(user.id, USER));
}

try {
  await db.insert(user).values({
    id: USER,
    name: "Webhook E2E",
    email: `${USER}@example.test`,
    emailVerified: true,
  });

  const [topup] = await db
    .insert(topups)
    .values({ userId: USER, amountXof: AMOUNT, status: "pending" })
    .returning();
  assert.ok(topup);

  const payment = await initiatePayment({
    amountXof: AMOUNT,
    description: `Webhook E2E ${RUN}`,
    paymentMethod: "wave",
    customer: { email: `${USER}@example.test`, phone: "+2250700000000", country: "CI" },
    metadata: { user_id: USER, topup_id: topup.id },
  });

  await db
    .update(topups)
    .set({ reference: payment.reference, status: "pending" })
    .where(eq(topups.id, topup.id));

  const status = await simulate(payment.reference);
  assert.equal(status, "completed");
  console.log(`✔ paiement ${payment.reference} complété en sandbox`);

  const payload = {
    id: `evt-${RUN}`,
    event: "payment.success",
    timestamp: Math.floor(Date.now() / 1000),
    created_at: new Date().toISOString(),
    data: {
      object: "transaction",
      id: 1,
      reference: payment.reference,
      amount: AMOUNT,
      currency: "XOF",
      fees: 0,
      net_amount: AMOUNT,
      status: "completed",
      payment_method: "wave",
      metadata: { user_id: USER, topup_id: topup.id },
    },
    environment: "sandbox",
    api_version: "2024-01-01",
  };

  // 1 — signature invalide : doit être rejetée
  const bad = await sendWebhook(payload, { secret: "whsec_mauvais_secret" });
  assert.equal(bad.http, 401, `attendu 401, reçu ${bad.http} — ${bad.body}`);
  console.log("✔ signature invalide rejetée (401)");
  assert.equal(await getBalance(USER), 0);

  // 2 — horodatage périmé : doit être rejeté
  const stale = await sendWebhook(payload, {
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  });
  assert.equal(stale.http, 401, `attendu 401, reçu ${stale.http} — ${stale.body}`);
  console.log("✔ horodatage périmé rejeté (401)");
  assert.equal(await getBalance(USER), 0);

  // 3 — signature valide : doit créditer
  // Diagnostic : qui a traité le paiement en premier ?
  const beforeWebhook = await db.select().from(topups).where(eq(topups.id, topup.id)).limit(1);
  console.log(`   état du topup avant webhook : ${beforeWebhook[0]?.status}`);

  const ok = await sendWebhook(payload);
  assert.equal(ok.http, 200, `attendu 200, reçu ${ok.http} — ${ok.body}`);
  console.log(`✔ webhook accepté : ${ok.body}`);
  assert.equal(await getBalance(USER), AMOUNT);
  console.log(`✔ solde crédité : ${AMOUNT} FCFA`);

  // 4 — rejeu : aucun double crédit
  const replay = await sendWebhook(payload);
  assert.equal(replay.http, 200);
  assert.equal(await getBalance(USER), AMOUNT);
  console.log("✔ rejeu du même webhook : aucun double crédit");

  // 5 — trace en base
  const rows = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, USER));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.providerTxnId, payment.reference);
  console.log("✔ une seule écriture au registre");

  console.log("\nWEBHOOK DE PRODUCTION VALIDÉ.");
} catch (error) {
  console.error("\n✖ ÉCHEC :", error);
  process.exitCode = 1;
} finally {
  await cleanup();
  process.exit(process.exitCode ?? 0);
}
