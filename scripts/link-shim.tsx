import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * Substitut de `next/link` pour le rendu statique : le même composant de page
 * est rendu hors de Next, sans dupliquer une ligne de JSX.
 */
export default function Link({
  href,
  children,
  ...rest
}: { href: string; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
