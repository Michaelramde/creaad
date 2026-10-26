import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/** Le tableau de bord interne ne doit pas être indexé. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    sitemap: `${env.APP_URL}/sitemap.xml`,
  };
}
