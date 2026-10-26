import type { MetadataRoute } from "next";

/**
 * Le layout annonçait `/manifest.webmanifest` depuis le premier jour : cette
 * route répondait 404 sur chaque page, et l'application n'était pas
 * installable malgré la promesse « PWA mobile-first » de la SPEC.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Creaad — de la photo produit au kit de vente",
    short_name: "Creaad",
    description:
      "Transforme les photos d'un produit en kit de vente : planche visuelle, angles du marché, créas publicitaires.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#1c1917",
    lang: "fr",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
