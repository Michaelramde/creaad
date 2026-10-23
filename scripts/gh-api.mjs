/**
 * Passerelle GitHub — lit le jeton depuis `.secrets/github_token.txt`.
 *
 * Le jeton n'est jamais affiché, jamais journalisé, jamais commité.
 *
 *   node scripts/gh-api.mjs whoami
 *   node scripts/gh-api.mjs runs
 *   node scripts/gh-api.mjs dispatch <workflow-file> [clé=valeur ...]
 *   node scripts/gh-api.mjs run <runId>
 *   node scripts/gh-api.mjs logs <runId>
 *
 * Les secrets Actions se créent depuis l'interface GitHub (Settings → Secrets) :
 * leur chiffrement exige une boîte scellée libsodium, qu'on n'embarque pas ici
 * pour éviter une implémentation approximative.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const OWNER = "Michaelramde";
const REPO = "creaad";

const tokenPath = ".secrets/github_token.txt";

if (!existsSync(tokenPath)) {
  console.error(
    `Jeton absent : ${tokenPath}\n\n` +
      "Crée un jeton fine-grained (7 jours) avec, sur le dépôt creaad :\n" +
      "  Contents        Read and write\n" +
      "  Workflows       Read and write\n" +
      "  Actions         Read and write\n" +
      "  Secrets         Read and write\n" +
      "puis écris-le, seul sur une ligne, dans ce fichier.",
  );
  process.exit(1);
}

const TOKEN = (await readFile(tokenPath, "utf8")).trim();
if (!TOKEN) {
  console.error("Fichier de jeton vide.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "creaad-agent",
};

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`GitHub ${path} → HTTP ${res.status} : ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "whoami": {
      const user = await api("/user");
      console.log(`connecté : ${user.login}`);
      const repo = await api(`/repos/${OWNER}/${REPO}`);
      console.log(`dépôt    : ${repo.full_name} · ${repo.private ? "privé" : "public"} · ${repo.default_branch}`);
      break;
    }

    case "runs": {
      const data = await api(`/repos/${OWNER}/${REPO}/actions/runs?per_page=8`);
      for (const run of data.workflow_runs) {
        console.log(
          `${run.id} · ${run.name} · ${run.status}/${run.conclusion ?? "—"} · ${run.created_at}`,
        );
      }
      break;
    }

    case "dispatch": {
      const [workflow, ...pairs] = args;
      if (!workflow) throw new Error("Usage : dispatch <workflow.yml> [clé=valeur ...]");
      const inputs = Object.fromEntries(pairs.map((p) => p.split("=")));
      await api(`/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/dispatches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs }),
      });
      console.log(`workflow ${workflow} déclenché sur main avec ${JSON.stringify(inputs)}`);
      break;
    }

    case "run": {
      const run = await api(`/repos/${OWNER}/${REPO}/actions/runs/${args[0]}`);
      console.log(`${run.name} · ${run.status} · ${run.conclusion ?? "en cours"}`);
      console.log(run.html_url);
      break;
    }

    case "logs": {
      const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${args[0]}/logs`, {
        headers: { ...headers, Accept: "application/vnd.github+json" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`logs → HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(`.tmp/logs-${args[0]}.zip`, buffer),
      );
      console.log(`archive écrite : .tmp/logs-${args[0]}.zip (${buffer.length} o)`);
      break;
    }

    case "jobs": {
      const data = await api(`/repos/${OWNER}/${REPO}/actions/runs/${args[0]}/jobs`);
      for (const job of data.jobs) {
        console.log(`\n${job.name} · ${job.status} · ${job.conclusion ?? "en cours"} · id ${job.id}`);
        for (const step of job.steps ?? []) {
          const mark = step.conclusion === "failure" ? "✖" : step.conclusion === "success" ? "✔" : "·";
          console.log(`  ${mark} ${step.name}`);
        }
      }
      break;
    }

    case "joblog": {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/jobs/${args[0]}/logs`,
        { headers, redirect: "follow" },
      );
      if (!res.ok) throw new Error(`joblog → HTTP ${res.status}`);
      const text = await res.text();
      // `--tail=N` limite l'affichage ; par défaut tout le log.
      const tailArg = args[1]?.startsWith("--tail=") ? Number(args[1].split("=")[1]) : 0;
      const lines = text.split("\n");
      console.log((tailArg > 0 ? lines.slice(-tailArg) : lines).join("\n"));
      break;
    }

    default:
      console.log("Commandes : whoami · runs · dispatch · run · logs · jobs · joblog");
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
