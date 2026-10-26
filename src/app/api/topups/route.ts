import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { topups } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { initiatePayment } from "@/lib/geniuspay/client";
import { checkTopupLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  amountXof: z.coerce.number().int().min(200),
  country: z.string().length(2).default("CI"),
});

/**
 * Initie une recharge. Le montant minimum (5 000 FCFA) est vérifié ici
 * ET en base — un client ne doit jamais pouvoir contourner le plancher.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }

  /**
   * Trois recharges par heure : au-delà, c'est un script ou un bug, pas un
   * commerçant. Sans ce garde-fou, /api/topups créait des paiements en série
   * chez GeniusPay sans aucun frein.
   */
  const quota = await checkTopupLimit(session.user.id);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: `${quota.max} recharges par heure maximum.`,
        used: quota.used,
        max: quota.max,
      },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  const { amountXof, country } = parsed.data;
  if (amountXof < env.MIN_TOPUP_XOF) {
    return NextResponse.json(
      { error: "BELOW_MINIMUM", minimum: env.MIN_TOPUP_XOF },
      { status: 400 },
    );
  }

  const [topup] = await db
    .insert(topups)
    .values({ userId: session.user.id, amountXof, status: "pending" })
    .returning();

  if (!topup) {
    return NextResponse.json({ error: "TOPUP_CREATE_FAILED" }, { status: 500 });
  }

  try {
    const payment = await initiatePayment({
      amountXof,
      description: `Recharge Creaad — ${topup.id.slice(0, 8)}`,
      // Wave est le rail le moins cher en CI (2,5 % + 100 contre ~4,5 %).
      // Sans `payment_method`, les frais varient de 2,5 % à 11 %.
      paymentMethod: country === "CI" ? "wave" : "pawapay",
      customer: {
        email: session.user.email,
        phone: session.user.phone ?? undefined,
        country,
      },
      metadata: { user_id: session.user.id, topup_id: topup.id },
      successUrl: `${env.APP_URL}/wallet?topup=${topup.id}`,
      errorUrl: `${env.APP_URL}/wallet?topup=${topup.id}&e=1`,
    });

    await db
      .update(topups)
      .set({
        reference: payment.reference,
        status: payment.status,
        gateway: country === "CI" ? "wave" : "pawapay",
        checkoutUrl: payment.checkoutUrl ?? null,
        expiresAt: payment.expiresAt ? new Date(payment.expiresAt) : null,
      })
      .where(eq(topups.id, topup.id));

    return NextResponse.json({
      topupId: topup.id,
      reference: payment.reference,
      checkoutUrl: payment.checkoutUrl,
      expiresAt: payment.expiresAt,
    });
  } catch (error) {
    await db.update(topups).set({ status: "failed" }).where(eq(topups.id, topup.id));
    console.error("[topups] initiation échouée", error);
    return NextResponse.json({ error: "PAYMENT_INIT_FAILED" }, { status: 502 });
  }
}
