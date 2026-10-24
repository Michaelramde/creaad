/**
 * Source AliExpress **sans navigateur ni clé API**.
 *
 * Deux temps, tous deux en HTTP simple :
 *  1. la page de recherche `/w/wholesale-<mots>.html` donne des identifiants ;
 *  2. chaque page produit expose `og:title` et `og:image`.
 *
 * AliExpress renvoie les IP de datacenter dans une boucle de redirections :
 * on suit à la main avec un pot à cookies, sinon `fetch` s'épuise.
 */
import type { Archetype } from "../archetype/extract.ts";
import { normalize } from "../matching/text.ts";
import type { Attributes, ListingCandidate } from "../matching/types.ts";
import { extractColorName, extractSize, parseVariantLabel } from "../matching/variant.ts";
import type { SourceAdapter } from "./types.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchHtml(startUrl: string, maxHops = 6): Promise<string> {
  let url = startUrl;
  let cookie = "";

  for (let hop = 0; hop < maxHops; hop += 1) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "fr-FR,fr;q=0.9",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      const jar = new Map<string, string>(
        cookie ? cookie.split("; ").map((c) => [c.split("=")[0] as string, c]) : [],
      );
      for (const raw of setCookie) {
        const pair = raw.split(";")[0];
        if (pair) jar.set(pair.split("=")[0] as string, pair);
      }
      cookie = [...jar.values()].join("; ");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return "";
      url = new URL(location, url).toString();
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  throw new Error("trop de redirections");
}

const ogMeta = (html: string, property: string): string | undefined => {
  const re = new RegExp(`<meta property="${property}" content="([^"]*)"`, "i");
  return re.exec(html)?.[1]?.replace(/&amp;/g, "&");
};

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
    const query = [input.archetype.noun, input.archetype.capacity]
      .filter(Boolean)
      .join(" ")
      .trim() || input.archetype.label;

    const html = await fetchHtml(
      `https://fr.aliexpress.com/w/wholesale-${encodeURIComponent(query.replace(/\s+/g, "-"))}.html`,
    );

    const ids = [...new Set([...html.matchAll(/\/item\/(\d{8,20})\.html/g)].map((m) => m[1] as string))].slice(
      0,
      limit,
    );

    const candidates = await Promise.all(
      ids.map((id) => this.enrich(id, input.archetype).catch(() => null)),
    );

    return candidates.filter((c): c is ListingCandidate => c !== null);
  }

  private async enrich(id: string, archetype: Archetype): Promise<ListingCandidate | null> {
    const url = `https://fr.aliexpress.com/item/${id}.html`;
    const html = await fetchHtml(url);

    const title = ogMeta(html, "og:title");
    if (!title) return null; // pas de titre = page anti-bot, on n'invente rien

    const image = ogMeta(html, "og:image");
    const description = ogMeta(html, "og:description");

    // Attributs déduits du titre : c'est peu, mais c'est mesuré, pas deviné.
    const variant = parseVariantLabel(title);
    const attributes: Attributes = { category: archetype.category };
    const color = extractColorName(title);
    if (color) attributes.color = color;

    const form = /flacon|bouteille|tube|pot|boite|coffret|pompe|spray/i.exec(normalize(title))?.[0];
    if (form) attributes.form = form;

    return {
      provider: this.name,
      externalId: id,
      url,
      title,
      description: description ?? undefined,
      images: image ? [{ url: image }] : [],
      attributes,
      variant: {
        ...(variant.colorName ? { colorName: variant.colorName } : {}),
        ...(variant.capacity ? { capacity: variant.capacity } : {}),
        ...(extractSize(title) ? { size: extractSize(title) as string } : {}),
      },
    };
  }
}
