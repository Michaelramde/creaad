import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/** Trois pages publiques : l'accueil, la démonstration, la connexion. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: env.APP_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${env.APP_URL}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${env.APP_URL}/wallet`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
