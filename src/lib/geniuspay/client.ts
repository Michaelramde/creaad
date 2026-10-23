/**
 * Client GeniusPay — appels serveur uniquement.
 * `GP_SK` ne doit jamais atteindre le client.
 *
 * Doc : https://geniuspay.ci/docs/api
 * Base : /api/v1/merchant
 */
import { env, requireEnv } from "@/lib/env";

export type GpStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired";

export interface InitiateInput {
  amountXof: number;
  description: string;
  customer: { email?: string; phone?: string; name?: string; country?: string };
  metadata: Record<string, string>;
  successUrl?: string;
  errorUrl?: string;
  /** Forcer le rail : sinon les frais varient de 2,5 % à 11 %. */
  paymentMethod?: "wave" | "pawapay" | "paystack" | "orange_money" | "mtn_money" | "card";
  gateway?: "wave" | "pawapay" | "orange_money" | "mtn_momo" | "moov_money";
}

export interface InitiateResult {
  reference: string;
  status: GpStatus;
  amountXof: number;
  checkoutUrl?: string;
  paymentUrl?: string;
  expiresAt?: string;
  environment?: string;
}

export interface PaymentState {
  reference: string;
  status: GpStatus;
  amountXof: number;
  currency: string;
  fees?: number;
  netAmount?: number;
  paymentMethod?: string | null;
  metadata: Record<string, string>;
  completedAt?: string | null;
}

interface GpEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  requireEnv("GP_PK", "GP_SK");

  const res = await fetch(`${env.GP_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-Key": env.GP_PK!,
      "X-API-Secret": env.GP_SK!,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    // Un paiement est un effet de bord : jamais de cache.
    cache: "no-store",
  });

  const text = await res.text();
  let body: GpEnvelope<T> | null = null;
  try {
    body = text ? (JSON.parse(text) as GpEnvelope<T>) : null;
  } catch {
    body = null;
  }

  if (!res.ok || !body?.success) {
    const detail = body?.error ? `${body.error.code} — ${body.error.message}` : text.slice(0, 300);
    throw new Error(`GeniusPay ${path} → HTTP ${res.status} : ${detail || "réponse illisible"}`);
  }

  return body.data;
}

export async function initiatePayment(input: InitiateInput): Promise<InitiateResult> {
  const data = await call<{
    reference: string;
    status: GpStatus;
    amount: number;
    checkout_url?: string;
    payment_url?: string;
    expires_at?: string;
    environment?: string;
  }>("/payments", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amountXof,
      currency: "XOF",
      description: input.description.slice(0, 500),
      ...(input.paymentMethod ? { payment_method: input.paymentMethod } : {}),
      ...(input.gateway ? { gateway: input.gateway } : {}),
      customer: {
        ...(input.customer.name ? { name: input.customer.name } : {}),
        ...(input.customer.email ? { email: input.customer.email } : {}),
        ...(input.customer.phone ? { phone: input.customer.phone } : {}),
        ...(input.customer.country ? { country: input.customer.country } : {}),
      },
      ...(input.successUrl ? { success_url: input.successUrl } : {}),
      ...(input.errorUrl ? { error_url: input.errorUrl } : {}),
      metadata: input.metadata,
    }),
  });

  return {
    reference: data.reference,
    status: data.status,
    amountXof: data.amount,
    checkoutUrl: data.checkout_url ?? data.payment_url,
    paymentUrl: data.payment_url,
    expiresAt: data.expires_at,
    environment: data.environment,
  };
}

/** Vérification serveur — ne jamais créditer sur la seule foi d'un webhook. */
export async function verifyPayment(reference: string): Promise<PaymentState> {
  const data = await call<{
    reference: string;
    status: GpStatus;
    amount: number;
    currency: string;
    fees?: number;
    net_amount?: number;
    payment_method?: string | null;
    metadata?: Record<string, string>;
    completed_at?: string | null;
  }>(`/payments/${encodeURIComponent(reference)}`);

  return {
    reference: data.reference,
    status: data.status,
    amountXof: data.amount,
    currency: data.currency,
    fees: data.fees,
    netAmount: data.net_amount,
    paymentMethod: data.payment_method ?? null,
    metadata: data.metadata ?? {},
    completedAt: data.completed_at ?? null,
  };
}

/** Réconciliation quotidienne : toutes les transactions d'une journée. */
export async function listCompletedPayments(from: string, to: string, perPage = 100) {
  return call<
    {
      id: number;
      reference: string;
      amount: number;
      status: GpStatus;
      payment_method?: string;
      created_at: string;
    }[]
  >(
    `/payments?status=completed&from=${from}&to=${to}&per_page=${perPage}`,
  );
}

export async function listProviders(country: string) {
  return call<{
    country: string;
    currency: string;
    providers: { code: string; name: string; type: string }[];
  }>(`/pawapay/providers?country=${country}`);
}
