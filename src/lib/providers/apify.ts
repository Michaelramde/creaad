/**
 * Client Apify minimal, avec le coût réel de chaque exécution.
 *
 * On passe par l'API asynchrone (et non `run-sync`) pour disposer de
 * l'identifiant d'exécution : c'est lui qui porte `usageTotalUsd`, donc le
 * prix effectivement facturé — pas celui annoncé.
 */
import { logPipelineCost } from "../costs.ts";

const BASE = "https://api.apify.com/v2";

export interface ApifyRun<T> {
  items: T[];
  runId: string;
  costUsd: number;
  durationMs: number;
}

interface RunInfo {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
  stats?: { durationMillis?: number };
}

const POLL_MS = 1_500;

export class ApifyClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async run<T>(
    actorId: string,
    input: unknown,
    options: { step: string; analysisId?: string; timeoutMs?: number } = { step: "apify" },
  ): Promise<ApifyRun<T>> {
    const timeoutMs = options.timeoutMs ?? 240_000;
    const started = Date.now();

    const startRes = await fetch(`${BASE}/acts/${actorId}/runs?token=${encodeURIComponent(this.token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });

    if (!startRes.ok) {
      const detail = await startRes.text().catch(() => "");
      throw new Error(`Apify ${actorId} → HTTP ${startRes.status} : ${detail.slice(0, 200)}`);
    }

    const started_ = ((await startRes.json()) as { data: RunInfo }).data;

    let run = started_;
    while (run.status === "READY" || run.status === "RUNNING") {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Apify ${actorId} : délai dépassé (${Math.round(timeoutMs / 1000)} s)`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));

      const pollRes = await fetch(`${BASE}/actor-runs/${run.id}?token=${encodeURIComponent(this.token)}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!pollRes.ok) throw new Error(`Apify : suivi impossible (HTTP ${pollRes.status})`);
      run = ((await pollRes.json()) as { data: RunInfo }).data;
    }

    const durationMs = run.stats?.durationMillis ?? Date.now() - started;
    const costUsd = run.usageTotalUsd ?? 0;

    await logPipelineCost({
      ...(options.analysisId ? { analysisId: options.analysisId } : {}),
      step: options.step,
      provider: "apify",
      model: actorId,
      costUsd,
      durationMs,
    });

    if (run.status !== "SUCCEEDED") {
      throw new Error(`Apify ${actorId} : exécution ${run.status}`);
    }

    const itemsRes = await fetch(
      `${BASE}/datasets/${run.defaultDatasetId}/items?token=${encodeURIComponent(this.token)}&clean=true`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!itemsRes.ok) throw new Error(`Apify : lecture du jeu de données impossible (HTTP ${itemsRes.status})`);

    return { items: (await itemsRes.json()) as T[], runId: run.id, costUsd, durationMs };
  }
}
