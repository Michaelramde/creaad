/**
 * Le dossier produit exporté.
 *
 * Règle unique, partagée par la démo et le parcours payant :
 * **ce qui n'a pas de coloris reste toujours, ce qui en a un suit la sélection.**
 * Les images de mesures et le marketing ne dépendent d'aucune couleur — les
 * exclure priverait le commerçant de ses dimensions.
 */
import type { PoolImage, ProductReview, VariantAxis } from "../products/types.ts";

export interface DossierSource {
  productId: string;
  title: string;
  url: string;
  specs: Record<string, string>;
  facts: Record<string, { value?: unknown; confidence?: string }>;
  images: PoolImage[];
  variantAxes: VariantAxis[];
  reviews: ProductReview[];
}

/** Dossier du ZIP selon la nature de l'image. */
export function imageFolder(image: PoolImage): string {
  switch (image.kind) {
    case "packshot":
    case "scene":
      return "produit";
    case "spec":
      return "mesures";
    case "marketing":
      return "marketing";
    default:
      return "autres";
  }
}

/**
 * Images retenues : celles sans coloris (mesures, marketing, sans produit)
 * plus celles des coloris cochés. `undefined` = tout garder.
 */
export function selectImages(images: readonly PoolImage[], selected?: readonly string[]): PoolImage[] {
  if (!selected) return [...images];
  return images.filter((image) => !image.variantValueId || selected.includes(image.variantValueId));
}

export function colourLabel(axes: readonly VariantAxis[], valueId?: string): string {
  if (!valueId) return "";
  for (const axis of axes) {
    const value = axis.values.find((candidate) => candidate.valueId === valueId);
    if (value) return value.name;
  }
  return valueId;
}

function fileName(index: number, image: PoolImage, label: string): string {
  const extension = /\.(png|webp|jpe?g)(?:\?|$)/i.exec(image.url)?.[1]?.toLowerCase() ?? "jpg";
  const slug = (label || "sans-coloris").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${String(index + 1).padStart(2, "0")}-${slug}-${image.kind ?? "image"}.${extension === "jpeg" ? "jpg" : extension}`;
}

export interface DossierFile {
  name: string;
  image: PoolImage;
}

/** Nom définitif de chaque image dans l'archive. */
export function dossierFiles(
  source: DossierSource,
  selected?: readonly string[],
): DossierFile[] {
  const kept = selectImages(source.images, selected);
  return kept.map((image, index) => ({
    name: `${imageFolder(image)}/${fileName(index, image, colourLabel(source.variantAxes, image.variantValueId))}`,
    image,
  }));
}

const dimensions = (facts: DossierSource["facts"]) => {
  const raw = facts.lengthWidthHeightMm?.value;
  const value = Array.isArray(raw) ? `${(raw as number[]).map((n) => n / 10).join(" × ")} cm` : null;
  return { value, confidence: facts.lengthWidthHeightMm?.confidence };
};

export function buildDossierMarkdown(source: DossierSource, selected?: readonly string[]): string {
  const dims = dimensions(source.facts);
  const colourAxis = source.variantAxes.find((axis) => axis.values.some((value) => value.image));
  const sold = colourAxis?.values.filter(
    (value) => !selected || selected.includes(value.valueId),
  );
  const excluded = colourAxis?.values.filter(
    (value) => selected && !selected.includes(value.valueId),
  );
  const perColour = (valueId: string) =>
    source.images.filter((image) => image.variantValueId === valueId).length;

  const lines: string[] = [
    `# ${source.title.replace(/\s+/g, " ").trim()}`,
    "",
    "## Identité",
    "",
    `- Marque : ${source.facts.brand?.value ?? "non communiqué"}`,
    `- Modèle : ${source.facts.model?.value ?? "non communiqué"}`,
    `- Matière : ${source.facts.material?.value ?? "non communiqué"}`,
    `- Référence fournisseur : ${source.productId}`,
    `- Lien : ${source.url}`,
    "",
    "## Coloris vendus",
    "",
  ];

  if (!sold || sold.length === 0) lines.push("Aucun coloris sélectionné.");
  for (const value of sold ?? []) {
    lines.push(`- ${value.name} (${perColour(value.valueId)} photos)`);
  }

  if (excluded && excluded.length > 0) {
    lines.push("", "## Ce qui n'est pas inclus", "");
    for (const value of excluded) lines.push(`- ${value.name} — non vendu`);
  }

  lines.push(
    "",
    "## Dimensions",
    "",
    `- Article : ${dims.value ?? "non communiqué"}`,
    `- Poids : ${source.facts.weightG?.value ? `${source.facts.weightG.value} g` : "non communiqué"}`,
    "- Emballage : non communiqué",
    "- Carton : non communiqué",
    "",
    `Source : ${dims.confidence === "corroboré" ? "deux sources concordantes" : "une seule source"} — tableau de mesures de la fiche.`,
    "",
    "## Fiche technique",
    "",
    "| Caractéristique | Valeur |",
    "| --- | --- |",
    ...Object.entries(source.specs).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## Avis clients",
    "",
  );

  if (source.reviews.length === 0) lines.push("Aucun avis collecté.");
  for (const review of source.reviews) {
    lines.push(
      `- ${"★".repeat(review.rating)} (${review.rating}/5) — ${[review.buyerCountry, review.date].filter(Boolean).join(", ")}`,
      `  « ${review.text.replace(/\s+/g, " ")} »`,
    );
  }

  const files = dossierFiles(source, selected);
  lines.push(
    "",
    "## Photos",
    "",
    `Total exporté : ${files.length} images`,
    "",
    ...files.map((file, index) => `${String(index + 1).padStart(2, "0")}. ${file.name}`),
  );

  return lines.join("\n");
}
