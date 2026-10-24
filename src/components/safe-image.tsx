"use client";

import { useState } from "react";

/**
 * Image distante tolérante aux pannes.
 *
 * Les CDN fournisseurs renvoient parfois une URL de vignette qui n'existe pas
 * au format demandé. Sans ça, la page affiche un carré vide — ce qui donne
 * l'impression que l'app ne fonctionne pas.
 */
export function SafeImage({
  src,
  alt = "",
  className,
  fallback = "Image indisponible",
}: {
  src: string;
  alt?: string;
  className?: string;
  fallback?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div
        className={`flex items-center justify-center bg-stone-100 p-1 text-center text-[9px] leading-tight text-stone-400 ${className ?? ""}`}
      >
        {fallback}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
      onError={() => setBroken(true)}
    />
  );
}
