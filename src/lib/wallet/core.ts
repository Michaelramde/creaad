/**
 * Cœur du registre wallet — PUR, sans I/O, sans variable d'environnement.
 *
 * Invariants garantis ici et testés dans `tests/wallet-core.test.ts` :
 *  1. Le solde est la somme signée des écritures.
 *  2. Aucune écriture ne peut rendre le solde négatif.
 *  3. Chaque écriture possède une clé d'idempotence stable.
 *  4. Un échec restitue intégralement la réservation.
 *
 * Conventions : amountXof est SIGNÉ. Crédit > 0, débit < 0.
 */

export type EntryType =
  | "recharge"
  | "reservation"
  | "reglement"
  | "liberation"
  | "remboursement"
  | "ajustement";

export interface EntryDraft {
  type: EntryType;
  amountXof: number;
  idempotencyKey: string;
  analysisId?: string;
  topupId?: string;
  provider?: string;
  providerTxnId?: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntryLike {
  amountXof: number;
}

export class InsufficientFundsError extends Error {
  readonly balance: number;
  readonly required: number;

  constructor(balance: number, required: number) {
    super(`Solde insuffisant : ${balance} FCFA disponibles, ${required} FCFA requis.`);
    this.name = "InsufficientFundsError";
    this.balance = balance;
    this.required = required;
  }
}

/** Solde courant = somme signée du registre. Jamais d'UPDATE d'un champ balance. */
export function balanceOf(entries: readonly LedgerEntryLike[]): number {
  return entries.reduce((sum, e) => sum + e.amountXof, 0);
}

/** Un lancement est possible si le solde couvre au moins un crédit. */
export function canLaunch(balance: number, creditXof: number): boolean {
  return balance >= creditXof;
}

/** Nombre d'analyses encore finançables. */
export function remainingAnalyses(balance: number, creditXof: number): number {
  if (creditXof <= 0) return 0;
  return Math.max(0, Math.floor(balance / creditXof));
}

/* ── Clés d'idempotence ────────────────────────────────────────────────────
   Stables et déterministes : rejouer la même opération ne crée jamais
   de seconde écriture. C'est la seule protection, GeniusPay n'exposant
   pas de clé d'idempotence côté API.                                        */

/**
 * Suffixe d'étape. L'étape 1 garde les clés historiques — les écritures déjà
 * en base restent valides — et l'étape 2 reçoit son propre espace de noms.
 */
const stepSuffix = (step: number) => (step <= 1 ? "" : `:etape${step}`);

export const idem = {
  recharge: (providerTxnId: string) => `recharge:${providerTxnId}`,
  reservation: (analysisId: string, step = 1) => `reservation:${analysisId}${stepSuffix(step)}`,
  liberation: (analysisId: string, step = 1) => `liberation:${analysisId}${stepSuffix(step)}`,
  reglement: (analysisId: string, step = 1) => `reglement:${analysisId}${stepSuffix(step)}`,
  remboursement: (topupId: string) => `remboursement:${topupId}`,
} as const;

/* ── Fabriques d'écritures ────────────────────────────────────────────────── */

export function creditEntry(input: {
  topupId: string;
  providerTxnId: string;
  amountXof: number;
  provider?: string;
}): EntryDraft {
  return {
    type: "recharge",
    amountXof: Math.abs(input.amountXof),
    idempotencyKey: idem.recharge(input.providerTxnId),
    topupId: input.topupId,
    provider: input.provider ?? "geniuspay",
    providerTxnId: input.providerTxnId,
  };
}

/** Réservation au lancement d'une étape (débit). */
export function reservationEntries(analysisId: string, amountXof: number, step = 1): EntryDraft[] {
  // La réservation est toujours un débit, quel que soit le signe reçu.
  return [
    {
      type: "reservation",
      amountXof: -Math.abs(amountXof),
      idempotencyKey: idem.reservation(analysisId, step),
      analysisId,
    },
  ];
}

/**
 * Règlement à la livraison : on libère la totalité de la réservation,
 * puis on débite le coût réel. L'effet net vaut `reserved - actual`.
 * Deux écritures plutôt qu'une : l'audit reste lisible.
 */
export function settleEntries(
  analysisId: string,
  reserved: number,
  actual: number,
  step = 1,
): EntryDraft[] {
  const reserve = Math.abs(reserved);
  const real = Math.abs(actual);
  return [
    {
      type: "liberation",
      amountXof: reserve,
      idempotencyKey: `${idem.liberation(analysisId, step)}:settle`,
      analysisId,
    },
    {
      type: "reglement",
      amountXof: -real,
      idempotencyKey: idem.reglement(analysisId, step),
      analysisId,
    },
  ];
}

/** Échec : restitution intégrale, le commerçant n'a rien payé pour cette étape. */
export function releaseEntries(analysisId: string, reserved: number, step = 1): EntryDraft[] {
  return [
    {
      type: "liberation",
      amountXof: Math.abs(reserved),
      idempotencyKey: idem.liberation(analysisId, step),
      analysisId,
    },
  ];
}

/**
 * Applique une suite d'écritures à un solde, en refusant tout passage
 * en négatif. Utilisé pour valider un lot AVANT écriture en base.
 */
export function applyEntries(
  balance: number,
  drafts: readonly Pick<EntryDraft, "amountXof" | "type">[],
): number {
  let running = balance;
  for (const d of drafts) {
    running += d.amountXof;
    if (running < 0) throw new InsufficientFundsError(balance, Math.abs(d.amountXof));
  }
  return running;
}
