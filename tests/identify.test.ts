import assert from "node:assert/strict";
import { test } from "node:test";

import { identifyArticle } from "../src/lib/pipeline/identify.ts";
import {
  EmptySourceAdapter,
  LocalOcrProvider,
  NoopAttributeProvider,
  NoopEmbeddingProvider,
} from "../src/lib/providers/defaults.ts";
import type { Providers } from "../src/lib/providers/types.ts";
import type { ListingCandidate } from "../src/lib/matching/types.ts";

const listing: ListingCandidate = {
  provider: "test",
  externalId: "ali-1",
  url: "https://example.test/p/1",
  title: "Serum Vitamine C 30 ml visage",
  description: "Serum éclaircissant vitamine C 30ml",
  attributes: { color: "jaune", category: "beaute", form: "flacon" },
  variant: { colorName: "jaune", capacity: "30ml" },
  images: [{ url: "https://example.test/i/1.jpg" }],
  embedding: [1, 0, 0],
};

function usableProviders(over: Partial<Providers> = {}): Providers {
  return {
    ocr: {
      name: "stub-ocr",
      extract: async () => ({
        text: "SERUM VITAMINE C 30 ml visage",
        confidence: 1,
        provider: "stub-ocr",
      }),
    },
    attributes: {
      name: "stub-attrs",
      describe: async () => ({ color: "jaune", category: "beaute", form: "flacon" }),
    },
    embeddings: { name: "stub-emb", embed: async () => [[1, 0, 0]] },
    sources: [
      {
        name: "stub-src",
        available: () => true,
        search: async () => [listing],
      },
    ],
    ...over,
  };
}

const input = {
  category: "beaute" as const,
  regime: "non_detenu" as const,
  country: "CI",
  imageUrls: ["https://example.test/u/1.jpg"],
  variantLabel: "Jaune 30 ml",
  userText: "Sérum Vitamine C",
};

test("appariement réussi : article identifié, analyse non bloquée", async () => {
  const out = await identifyArticle(usableProviders(), input);
  assert.equal(out.blocked, false);
  assert.equal(out.match.accepted, true);
  assert.equal(out.candidatesFound, 1);
  assert.equal(out.archetype.slug, "beaute-serum-30ml");
  assert.ok(out.match.score >= 70);
});

test("sans fournisseur de sources : blocage, et la raison est dite", async () => {
  const out = await identifyArticle(
    {
      ocr: new LocalOcrProvider(),
      attributes: new NoopAttributeProvider(),
      embeddings: new NoopEmbeddingProvider(),
      sources: [new EmptySourceAdapter()],
    },
    input,
  );
  assert.equal(out.blocked, true);
  assert.equal(out.match.gateReason, "NO_CANDIDATE");
  assert.equal(out.candidatesFound, 0);
  assert.ok(out.warnings.some((w) => w.includes("Aucune annonce")));
});

test("un OCR en échec n'interrompt pas l'étape — l'avertissement est remonté", async () => {
  const out = await identifyArticle(
    usableProviders({
      ocr: {
        name: "ocr-cassé",
        extract: async () => {
          throw new Error("503");
        },
      },
    }),
    input,
  );
  assert.ok(out.warnings.some((w) => w.includes("OCR indisponible")));
  // Le texte utilisateur reste exploitable pour l'archétype.
  assert.equal(out.archetype.category, "beaute");
});

test("une source en échec est signalée, les autres continuent", async () => {
  const out = await identifyArticle(
    usableProviders({
      sources: [
        {
          name: "source-cassee",
          available: () => true,
          search: async () => {
            throw new Error("timeout");
          },
        },
        {
          name: "source-ok",
          available: () => true,
          search: async () => [listing],
        },
      ],
    }),
    input,
  );
  assert.equal(out.candidatesFound, 1);
  assert.equal(out.blocked, false);
  assert.ok(out.warnings.some((w) => w.includes("source-cassee")));
});

test("variante incompatible : le score chute et le détail l'explique", async () => {
  const out = await identifyArticle(
    usableProviders({
      sources: [
        {
          name: "stub-src",
          available: () => true,
          search: async () => [{ ...listing, variant: { colorName: "noir", capacity: "30ml" } }],
        },
      ],
    }),
    input,
  );
  assert.ok(out.match.score < 100);
  assert.match(out.match.components.variant.detail, /1\/2/);
});
