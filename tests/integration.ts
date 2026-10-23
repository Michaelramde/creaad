/**
 * Test d'intégration contre la vraie base Neon.
 * Exerce le code du registre, pas une réécriture SQL.
 *
 *   node --env-file=.env.local scripts/run-integration.mjs
 */
import assert from "node:assert/strict";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { analyses, archetypes, products, topups, user, walletTransactions } from "@/lib/db/schema";
import { getMarketKit, invalidateMarketKit, putMarketKit } from "@/lib/cache/store";
import { identifyArticle } from "@/lib/pipeline/identify";
import {
  EmptySourceAdapter,
  LocalOcrProvider,
  NoopAttributeProvider,
  NoopEmbeddingProvider,
} from "@/lib/providers/defaults";
import {
  creditTopup,
  getBalance,
  getWalletSummary,
  InsufficientFundsError,
  releaseAnalysis,
  reserveForAnalysis,
  settleAnalysis,
} from "@/lib/wallet/repo";

const RUN = Date.now().toString(36);
const USER = `test-user-${RUN}`;
const results: string[] = [];

function ok(label: string) {
  results.push(`✔ ${label}`);
  console.log(`✔ ${label}`);
}

async function cleanup() {
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, USER));
  await db.delete(analyses).where(eq(analyses.userId, USER));
  await db.delete(topups).where(eq(topups.userId, USER));
  await db.delete(products).where(eq(products.userId, USER));
  await db.delete(archetypes).where(eq(archetypes.slug, `test-${RUN}`));
  await db.delete(user).where(eq(user.id, USER));
}

async function main() {
  await db.insert(user).values({
    id: USER,
    name: "Test",
    email: `${USER}@example.test`,
    emailVerified: true,
  });

  const [productRow] = await db
    .insert(products)
    .values({ userId: USER, category: "beaute", regime: "non_detenu", name: "Sérum test" })
    .returning();
  if (!productRow) throw new Error("produit de test non créé");
  const product = productRow;

  async function newAnalysis() {
    const [a] = await db
      .insert(analyses)
      .values({ productId: product.id, userId: USER, country: "CI" })
      .returning();
    assert.ok(a);
    return a.id;
  }

  async function newTopup(amount: number) {
    const [t] = await db
      .insert(topups)
      .values({ userId: USER, amountXof: amount, status: "pending" })
      .returning();
    assert.ok(t);
    return t.id;
  }

  // 1 — solde initial
  assert.equal(await getBalance(USER), 0);
  ok("solde initial à 0");

  // 2 — crédit d'une recharge
  const t1 = await newTopup(5000);
  const c1 = await creditTopup({
    userId: USER,
    topupId: t1,
    providerTxnId: `MTX-${RUN}-1`,
    expectedXof: 5000,
    paidXof: 5000,
  });
  assert.equal(c1.balance, 5000);
  assert.equal(c1.credited, true);
  ok("recharge de 5 000 créditée");

  // 3 — webhook rejoué : aucun double crédit
  const c2 = await creditTopup({
    userId: USER,
    topupId: t1,
    providerTxnId: `MTX-${RUN}-1`,
    expectedXof: 5000,
    paidXof: 5000,
  });
  assert.equal(c2.balance, 5000);
  assert.equal(c2.credited, false);
  ok("webhook rejoué → aucun double crédit");

  // 4 — l'index partiel bloque un second crédit sur la même transaction,
  //     même avec une clé d'idempotence différente (protection de dernier recours).
  const t2 = await newTopup(5000);
  const dupError = await db
    .insert(walletTransactions)
    .values({
      userId: USER,
      type: "recharge",
      amountXof: 5000,
      balanceAfter: 9999,
      topupId: t2,
      provider: "geniuspay",
      providerTxnId: `MTX-${RUN}-1`,
      idempotencyKey: `bypass-${RUN}`,
    })
    .then(() => null)
    .catch((e: unknown) => e);

  assert.ok(dupError, "l'insertion en doublon aurait dû être rejetée");
  const cause = (dupError as { cause?: { code?: string; constraint?: string } }).cause ?? {};
  assert.equal(cause.code, "23505", `code attendu 23505, reçu ${cause.code ?? "aucun"}`);
  assert.match(cause.constraint ?? "", /ux_wtx_provider_txn/);
  ok("index unique (provider, provider_txn_id) — contournement impossible");

  // 5 — montant divergent refusé
  const t3 = await newTopup(5000);
  await assert.rejects(
    creditTopup({
      userId: USER,
      topupId: t3,
      providerTxnId: `MTX-${RUN}-3`,
      expectedXof: 5000,
      paidXof: 4000,
    }),
    /Montant divergent/,
  );
  assert.equal(await getBalance(USER), 5000);
  ok("montant divergent refusé, solde inchangé");

  // 6 — réservation
  const a1 = await newAnalysis();
  const r1 = await reserveForAnalysis({ userId: USER, analysisId: a1 });
  assert.equal(r1.balance, 4000);
  ok("réservation de 1 crédit → 4 000");

  // 7 — réservation rejouée : sans effet
  const r2 = await reserveForAnalysis({ userId: USER, analysisId: a1 });
  assert.equal(r2.balance, 4000);
  ok("réservation rejouée → solde inchangé");

  // 8 — libération intégrale sur échec
  const rel = await releaseAnalysis({ userId: USER, analysisId: a1, reservedXof: 1000 });
  assert.equal(rel.balance, 5000);
  ok("échec → libération intégrale, 5 000 restitués");

  // 9 — réservation puis règlement d'un coût réel inférieur
  const a2 = await newAnalysis();
  await reserveForAnalysis({ userId: USER, analysisId: a2 });
  const s1 = await settleAnalysis({
    userId: USER,
    analysisId: a2,
    reservedXof: 1000,
    actualXof: 700,
  });
  assert.equal(s1.balance, 4300);
  ok("règlement à 700 → 4 300 (trop-perçu restitué)");

  // 10 — règlement rejoué : sans effet
  const s2 = await settleAnalysis({
    userId: USER,
    analysisId: a2,
    reservedXof: 1000,
    actualXof: 700,
  });
  assert.equal(s2.balance, 4300);
  ok("règlement rejoué → solde inchangé");

  // 11 — solde négatif impossible
  const a3 = await newAnalysis();
  await reserveForAnalysis({ userId: USER, analysisId: a3 });
  await reserveForAnalysis({ userId: USER, analysisId: a3 }).catch(() => {});
  const drained = await Promise.all(
    Array.from({ length: 6 }, async (_, i) => {
      const id = await newAnalysis();
      return reserveForAnalysis({ userId: USER, analysisId: id }).catch((e) => e);
    }),
  );
  assert.ok(drained.some((r) => r instanceof InsufficientFundsError));
  assert.ok((await getBalance(USER)) >= 0);
  ok("dépassement de solde → InsufficientFundsError, jamais négatif");

  // 12 — cohérence du registre : somme = solde, chaîne balance_after exacte
  const rows = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, USER))
    .orderBy(walletTransactions.createdAt, walletTransactions.id);

  const sum = rows.reduce((acc, r) => acc + r.amountXof, 0);
  const balance = await getBalance(USER);
  assert.equal(sum, balance);
  assert.equal(rows.at(-1)?.balanceAfter, balance);
  ok(`registre cohérent (${rows.length} écritures, somme = solde = ${balance})`);

  // 13 — résumé wallet
  const summary = await getWalletSummary(USER);
  assert.equal(summary.balanceXof, balance);
  assert.equal(summary.creditXof, 1000);
  assert.equal(summary.minTopupXof, 5000);
  assert.equal(summary.canLaunch, balance >= 1000);
  ok(`résumé wallet : ${summary.remaining} analyse(s) disponible(s)`);

  // 14 — verrou consultatif : écritures concurrentes sérialisées
  const t4 = await newTopup(3000);
  await creditTopup({
    userId: USER,
    topupId: t4,
    providerTxnId: `MTX-${RUN}-4`,
    expectedXof: 3000,
    paidXof: 3000,
  });
  const beforeBurst = await getBalance(USER);

  const concurrent = await Promise.all(
    Array.from({ length: 5 }, async () => {
      const id = await newAnalysis();
      return reserveForAnalysis({ userId: USER, analysisId: id }).catch((e) => e);
    }),
  );
  const successes = concurrent.filter(
    (r): r is { balance: number; debited: boolean } => !(r instanceof Error),
  );
  const failures = concurrent.filter((r) => r instanceof Error);

  // Une réussite qui ne débite pas signalerait un rejeu d'idempotence
  // sur une analyse fraîche : anomalie, pas succès.
  assert.ok(
    successes.every((r) => r.debited),
    `réservation résolue sans débit : ${successes.filter((r) => !r.debited).length}`,
  );
  assert.ok(
    failures.every((r) => r instanceof InsufficientFundsError),
    `échec inattendu : ${failures.map((f) => String(f)).join(", ")}`,
  );

  const succeeded = successes.length;

  // Le solde renvoyé par la transaction est autoritaire : il est calculé
  // sous verrou, dans l'ordre de sérialisation.
  const minReported = Math.min(...successes.map((s) => s.balance));
  assert.equal(succeeded, Math.floor(beforeBurst / 1000));
  assert.equal(minReported, beforeBurst - succeeded * 1000);

  // Une relecture immédiate peut précéder la confirmation de commit d'une
  // transaction concurrente sur une autre connexion du pool : on vérifie
  // la convergence au lieu de supposer une visibilité instantanée.
  let observed = await getBalance(USER);
  for (let i = 0; i < 20 && observed !== minReported; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    observed = await getBalance(USER);
  }
  assert.equal(observed, minReported);
  ok(`5 réservations concurrentes → ${succeeded} acceptées, solde convergent (${observed})`);

  // 15 — identification bloquée faute de fournisseur : réservation restituée
  const t5 = await newTopup(2000);
  await creditTopup({
    userId: USER,
    topupId: t5,
    providerTxnId: `MTX-${RUN}-5`,
    expectedXof: 2000,
    paidXof: 2000,
  });
  const before14 = await getBalance(USER);

  const a4 = await newAnalysis();
  await reserveForAnalysis({ userId: USER, analysisId: a4 });
  assert.equal(await getBalance(USER), before14 - 1000);

  const identified = await identifyArticle(
    {
      ocr: new LocalOcrProvider(),
      attributes: new NoopAttributeProvider(),
      embeddings: new NoopEmbeddingProvider(),
      sources: [new EmptySourceAdapter()],
    },
    {
      category: "beaute",
      regime: "non_detenu",
      country: "CI",
      imageUrls: ["https://example.test/u/1.jpg?text=serum%20vitamine%20c%2030%20ml"],
      userText: "Sérum Vitamine C",
    },
  );
  assert.equal(identified.blocked, true);
  assert.equal(identified.match.gateReason, "NO_CANDIDATE");

  await releaseAnalysis({ userId: USER, analysisId: a4, reservedXof: 1000 });
  assert.equal(await getBalance(USER), before14);

  await db
    .update(analyses)
    .set({
      status: "bloquee_article",
      failureCode: identified.match.gateReason,
      matchScore: identified.match.score,
      matchCoverage: identified.match.coverage.toFixed(2),
      archetypeSlug: identified.archetype.slug,
    })
    .where(eq(analyses.id, a4));

  const [blocked] = await db.select().from(analyses).where(eq(analyses.id, a4));
  assert.equal(blocked?.status, "bloquee_article");
  assert.equal(blocked?.archetypeSlug, "beaute-serum-30ml");
  ok("identification bloquée → statut bloquee_article, réservation restituée, 0 débit");

  // 16 — cache marché : upsert, refus des données insuffisantes, expiration
  const [arch] = await db
    .insert(archetypes)
    .values({ slug: `test-${RUN}`, label: "Sérum test", category: "beaute" })
    .returning();
  if (!arch) throw new Error("archétype de test non créé");

  const now = Date.now();

  const first = await putMarketKit({
    archetypeId: arch.id,
    country: "CI",
    content: { version: 1 },
    adsFound: 22,
    confidence: "low",
    now,
  });
  assert.equal(first.stored, true);

  const hit = await getMarketKit({ archetypeId: arch.id, country: "CI", now });
  assert.equal(hit.hit, true);
  if (hit.hit) assert.equal(hit.kit.adsFound, 22);

  const refused = await putMarketKit({
    archetypeId: arch.id,
    country: "CI",
    content: { version: 9 },
    adsFound: 5,
    confidence: "insufficient",
    now,
  });
  assert.equal(refused.stored, false);
  assert.equal(refused.reason, "confidence_insufficient");

  const updated = await putMarketKit({
    archetypeId: arch.id,
    country: "CI",
    content: { version: 2 },
    adsFound: 70,
    confidence: "high",
    now,
  });
  assert.equal(updated.stored, true);

  const hit2 = await getMarketKit({ archetypeId: arch.id, country: "CI", now });
  assert.equal(hit2.hit, true);
  if (hit2.hit) {
    assert.equal(hit2.kit.adsFound, 70);
    assert.ok(hit2.remainingDays > 25, `jours restants : ${hit2.remainingDays}`);
  }

  const expired = await getMarketKit({
    archetypeId: arch.id,
    country: "CI",
    now: now + 40 * 86_400_000,
  });
  assert.equal(expired.hit, false);
  if (!expired.hit) assert.equal(expired.reason, "expired");

  const removed = await invalidateMarketKit({ archetypeId: arch.id, country: "CI" });
  assert.equal(removed, 1);

  const gone = await getMarketKit({ archetypeId: arch.id, country: "CI", now });
  assert.equal(gone.hit, false);
  if (!gone.hit) assert.equal(gone.reason, "absent");

  ok("cache marché : upsert, refus des données insuffisantes, expiration, invalidation");

  console.log(`\n${results.length} vérifications passées contre Neon.`);
}

try {
  await main();
} catch (error) {
  console.error("\n✖ ÉCHEC :", error);
  await cleanup();
  process.exit(1);
} finally {
  await cleanup();
  console.log("Données de test supprimées.");
}
process.exit(0);
