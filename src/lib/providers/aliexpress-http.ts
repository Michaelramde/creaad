/**
 * Source AliExpress **sans navigateur ni clé API**.
 *
 * La page de recherche `/w/wholesale-<mots>.html` embarque un JSON
 * `itemList.content` qui contient déjà, pour chaque produit : identifiant,
 * titre, image et prix. On n'appelle donc **jamais** la page produit — celle-ci
 * est bloquée depuis les IP datacenter (2 Ko, sans `og:title`), alors que la
 * recherche répond normalement (~750 Ko). Constaté en production le 24/10.
 */
import type { Archetype } from "../archetype/extract.ts";
import { normalize } from "../matching/text.ts";
import type { Attributes, ListingCandidate } from "../matching/types.ts";
import { extractColorName, extractSize, parseVariantLabel } from "../matching/variant.ts";
import type { SourceAdapter } from "./types.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Extrait un tableau JSON équilibré à partir de son crochet ouvrant. */
export function extractJsonArray(source: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }

  return null;
}

interface SearchItem {
  productId?: string;
  title?: { displayTitle?: string };
  image?: { imgUrl?: string };
  prices?: { salePrice?: { formattedPrice?: string } };
}

export function parseSearchItems(html: string): SearchItem[] {
  const marker = '"itemList":{"content":[';
  const at = html.indexOf(marker);
  if (at === -1) return [];

  const start = at + marker.length - 1;
  const raw = extractJsonArray(html, start);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SearchItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class AliExpressHttpSource implements SourceAdapter {
  readonly name = "aliexpress-http";

  available(): boolean {
    return true;
  }

  async search(input: {
    archetype: Archetype;
    country: string;
    limit?: number;
  }): Promise<ListingCandidate[]> {
    const limit = input.limit ?? 5;
    const query =
      [input.archetype.noun, input.archetype.capacity].filter(Boolean).join(" ").trim() ||
      input.archetype.label;

    const html = await fetchHtml(
      `https://fr.aliexpress.com/w/wholesale-${encodeURIComponent(query.replace(/\s+/g, "-"))}.html`,
    );

    const items = parseSearchItems(html).slice(0, limit);
    const candidates: ListingCandidate[] = [];

    for (const item of items) {
      const id = item.productId;
      const title = item.title?.displayTitle;
      if (!id || !title) continue;

      const variant = parseVariantLabel(title);
      const attributes: Attributes = { category: input.archetype.category };
      const color = extractColorName(title);
      if (color) attributes.color = color;
      const form = /flacon|bouteille|tube|pot|boite|coffret|pompe|spray/i.exec(normalize(title))?.[0];
      if (form) attributes.form = form;

      const rawImage = item.image?.imgUrl;
      const image = rawImage
        ? rawImage.startsWith("//")
          ? `https:${rawImage}`
          : rawImage
        : undefined;

      candidates.push({
        provider: this.name,
        externalId: id,
        url: `https://fr.aliexpress.com/item/${id}.html`,
        title,
        ...(item.prices?.salePrice?.formattedPrice
          ? { description: `Prix affiché : ${item.prices.salePrice.formattedPrice}` }
          : {}),
        images: image ? [{ url: image }] : [],
        attributes,
        variant: {
          ...(variant.colorName ? { colorName: variant.colorName } : {}),
          ...(variant.capacity ? { capacity: variant.capacity } : {}),
          ...(extractSize(title) ? { size: extractSize(title) as string } : {}),
        },
      });
    }

    return candidates;
  }
}
