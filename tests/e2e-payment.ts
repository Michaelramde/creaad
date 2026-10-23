/**
 * Bout en bout, en sandbox : topup en base → initiation GeniusPay →
 * simulation de paiement → `syncTopup` (le code utilisé par le webhook) →
 * crédit du wallet → solde.
 *
 *   node --env-file=.env.local .tmp/e2e-payment.mjs
 */
import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { topups, user, walletTransactions } from "@/lib/db/schema";
import { initiatePayment, verifyPayment } from "@/lib/geniuspay/client";
import { syncTopup } from "@/lib/payments/settle";
import { getBalance } from "@/lib/wallet/repo";

const RUN = Date.now().toString(36);
const USER = `e2e-${RUN}`;
const AMOUNT = 5000;

async function simulate(reference: string, scenario = "success", gateway = "wave") {
  const checkoutUrl = `https://geniuspay.ci/checkout/${reference}`;
  const page = await fetch(checkoutUrl, { signal: AbortSignal.timeout(30_000) });
  const html = await page.text();
  const cookies = page.headers.getSetCookie?.() ?? [];
  const csrf = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1];
  if (!csrf) throw new Error("Jeton CSRF introuvable sur la page de checkout");

  const res = await fetch(`${checkoutUrl}/sandbox/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRF-TOKEN": csrf,
      Cookie: cookies.map((c) => c.split(";")[0]).join("; "),
    },
    body: JSON.stringify({ scenario, gateway }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { success?: boolean; data?: { status?: string } };
  return { http: res.status, status: body.data?.status };
}

async function cleanup() {
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, USER));
  await db.delete(topups).where(eq(topups.userId, USER));
  await db.delete(user).where(eq(user.id, USER));
}

try {
  await db.insert(user).values({
    id: USER,
    name: "E2E",
    email: `${USER}@example.test`,
    emailVerified: true,
  });

  const [topup] = await db
    .insert(topups)
    .values({ userId: USER, amountXof: AMOUNT, status: "pending" })
    .returning();
  assert.ok(topup);
  console.log("✔ topup créé en base");

  const payment = await initiatePayment({
    amountXof: AMOUNT,
    description: `E2E ${RUN}`,
    paymentMethod: "wave",
    customer: { email: `${USER}@example.test`, phone: "+2250700000000", country: "CI" },
    metadata: { user_id: USER, topup_id: topup.id },
  });
  assert.ok(payment.reference);
  console.log(`✔ paiement initié : ${payment.reference} (${payment.status})`);

  await db
    .update(topups)
    .set({ reference: payment.reference, status: "pending" })
    .where(eq(topups.id, topup.id));

  const sim = await simulate(payment.reference);
  assert.equal(sim.status, "completed");
  console.log(`✔ paiement simulé : statut ${sim.status}`);

  const afterSim = await verifyPayment(payment.reference);
  assert.equal(afterSim.status, "completed");
  assert.equal(afterSim.amountXof, AMOUNT);
  console.log(`✔ vérification serveur : ${afterSim.status}, ${afterSim.amountXof} XOF`);

  const before = await getBalance(USER);
  assert.equal(before, 0);

  const outcome = await syncTopup(payment.reference);
  assert.equal(outcome.result, "credited");
  const balance = await getBalance(USER);
  assert.equal(balance, AMOUNT);
  console.log(`✔ crédit : solde ${before} → ${balance} FCFA`);

  // Rejeu : le webhook peut arriver trois fois, le solde ne doit pas bouger.
  const replay = await syncTopup(payment.reference);
  assert.equal(replay.result, "already_credited");
  assert.equal(await getBalance(USER), AMOUNT);
  console.log("✔ rejeu : aucun double crédit");

  const rows = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, USER));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.providerTxnId, payment.reference);
  assert.equal(rows[0]?.type, "recharge");
  console.log("✔ registre : une seule écriture, traçable jusqu'à la référence GeniusPay");

  console.log("\nBOUT EN BOUT VALIDÉ EN SANDBOX.");
} catch (error) {
  console.error("\n✖ ÉCHEC :", error);
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log("Données de test supprimées.");
  process.exit(process.exitCode ?? 0);
}
