#!/usr/bin/env python3
"""
Recherche d'annonces Meta via `meta-ads-collector` (open source, sans clé API).

Sortie : un JSONL normalisé au maximum, que `normalize.mjs` transformera en
lignes `ad_observations`. Les champs absents restent absents — jamais inventés.

    python scripts/collector/meta_search.py --seeds scripts/collector/seeds.json \
        --out .tmp/ads.jsonl --max 20
"""
import argparse
import json
import sys
from datetime import datetime, timezone


def pick(obj, *names):
    """Premier attribut non vide parmi `names`."""
    for name in names:
        value = getattr(obj, name, None)
        if value not in (None, "", [], {}):
            return value
    return None


def as_iso(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Meta renvoie parfois des timestamps UNIX en secondes.
        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return None


def to_record(ad, seed):
    """Convertit un objet `ad` de la librairie en ligne stable pour notre base."""
    fields = getattr(ad, "api_fields", None) or {}
    page = getattr(ad, "page", None)

    page_name = pick(page, "name") if page is not None else None
    page_id = pick(page, "id") if page is not None else None

    # Le hook est le texte créatif principal quand il est exposé.
    hook = None
    for key in ("ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_captions"):
        value = fields.get(key)
        if isinstance(value, list) and value:
            hook = value[0]
            break
        if isinstance(value, str) and value:
            hook = value
            break
    if hook is None:
        hook = pick(ad, "body", "text", "title")

    ad_id = pick(ad, "id", "ad_archive_id", "adArchiveId")
    if ad_id is None:
        return None

    return {
        "archetypeSlug": seed["archetypeSlug"],
        "country": seed["country"],
        "platform": "meta",
        "advertiserId": str(page_id or page_name or ad_id),
        "advertiserName": page_name,
        "hook": hook if isinstance(hook, str) else None,
        "startDate": as_iso(pick(ad, "start_date", "startDate")),
        "endDate": as_iso(pick(ad, "end_date", "endDate")),
        "isActive": bool(pick(ad, "is_active", "isActive") or False),
        "url": f"https://www.facebook.com/ads/library/?id={ad_id}",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", default="scripts/collector/seeds.json")
    parser.add_argument("--out", default=".tmp/ads.jsonl")
    parser.add_argument("--max", type=int, default=20, help="résultats par archétype")
    args = parser.parse_args()

    try:
        from meta_ads_collector import MetaAdsCollector
    except ImportError:
        print("meta-ads-collector absent : pip install meta-ads-collector", file=sys.stderr)
        return 1

    with open(args.seeds, encoding="utf-8") as handle:
        seeds = json.load(handle)["targets"]

    total = 0
    written = 0

    with open(args.out, "w", encoding="utf-8") as out, MetaAdsCollector() as collector:
        for seed in seeds:
            try:
                ads = list(
                    collector.search(
                        query=seed["query"],
                        country=seed["country"],
                        max_results=args.max,
                    )
                )
            except Exception as error:  # réseau, rate limit, changement côté Meta
                print(f"  ! {seed['archetypeSlug']} : {error}", file=sys.stderr)
                continue

            kept = 0
            for ad in ads:
                record = to_record(ad, seed)
                if record is None:
                    continue
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                kept += 1

            total += len(ads)
            written += kept
            print(f"  meta · {seed['archetypeSlug']} · {kept}/{len(ads)} annonce(s)")

    print(f"\n{written} annonce(s) écrite(s) dans {args.out} (sur {total} reçues).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
