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

  private async fetchRun(runId: string): Promise<RunInfo> {
    const res = await fetch(`${BASE}/actor-runs/${runId}?token=${encodeURIComponent(this.token)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Apify : suivi impossible (HTTP ${res.status})`);
    return ((await res.json()) as { data: RunInfo }).data;
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

    let run = ((await startRes.json()) as { data: RunInfo }).data;

    while (run.status === "READY" || run.status === "RUNNING") {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Apify ${actorId} : délai dépassé (${Math.round(timeoutMs / 1000)} s)`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      run = await this.fetchRun(run.id);
    }

    /**
     * La facturation n'est écrite qu'**après** la fin de l'exécution : relire
     * tout de suite donne 0 alors que l'appel a bien été payé. On laisse
     * quelques instants, puis on marque la ligne « estimée » pour que la
     * dépense ne disparaisse jamais du plafond.
     */
    let costUsd = run.usageTotalUsd ?? 0;
    for (let attempt = 0; attempt < 4 && costUsd === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      try {
        run = await this.fetchRun(run.id);
        costUsd = run.usageTotalUsd ?? 0;
      } catch {
        break;
      }
    }

    const durationMs = run.stats?.durationMillis ?? Date.now() - started;

    await logPipelineCost({
      ...(options.analysisId ? { analysisId: options.analysisId } : {}),
      step: options.step,
      provider: "apify",
      model: actorId,
      costUsd,
      durationMs,
      estimated: costUsd === 0,
      externalId: run.id,
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
