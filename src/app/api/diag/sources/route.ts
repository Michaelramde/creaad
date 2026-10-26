import { NextResponse } from "next/server";

import { parseSearchItems } from "@/lib/providers/aliexpress-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic réseau depuis l'environnement de production.
 * Protégé par une clé : sert uniquement à savoir si une source est joignable
 * depuis Vercel (les anti-bots traitent différemment datacenter et résidentiel).
 */
export async function GET(req: Request) {
  const key = process.env.DIAG_KEY;
  if (!key || req.headers.get("x-diag-key") !== key) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target || !/^https?:\/\//.test(target)) {
    return NextResponse.json({ error: "BAD_URL" }, { status: 400 });
  }

  /**
   * Cette route est une sonde : elle existait comme **proxy HTTP arbitraire**
   * protégé par une clé statique. Si la clé fuit, c'est un SSRF. On la limite
   * aux domaines qu'elle est censée diagnostiquer.
   */
  const ALLOWED_HOSTS = ["aliexpress.com", "www.aliexpress.com", "fr.aliexpress.com", "m.aliexpress.com"];
  let host = "";
  try {
    host = new URL(target).hostname.toLowerCase();
  } catch {
    return NextResponse.json({ error: "BAD_URL" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    return NextResponse.json(
      { error: "HOST_NOT_ALLOWED", host, allowed: ALLOWED_HOSTS },
      { status: 403 },
    );
  }

  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const body = await res.text();
    const items = parseSearchItems(body).slice(0, 3).map((item) => ({
      id: item.productId,
      title: item.title?.displayTitle?.slice(0, 80),
      image: item.image?.imgUrl?.startsWith("//")
        ? `https:${item.image.imgUrl}`
        : item.image?.imgUrl,
    }));

    return NextResponse.json({
      status: res.status,
      finalUrl: res.url.slice(0, 120),
      bytes: body.length,
      itemLinks: (body.match(/\/item\/\d{8,20}\.html/g) ?? []).length,
      productLinks: (body.match(/\/catalog\/\?q=|class="prd/g) ?? []).length,
      ogTitle: /<meta property="og:title" content="([^"]*)"/i.exec(body)?.[1]?.slice(0, 80) ?? null,
      blocked: /captcha|challenge|noscript|robot|access denied/i.test(body.slice(0, 5000)),
      items,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error).slice(0, 200) }, { status: 502 });
  }
}
