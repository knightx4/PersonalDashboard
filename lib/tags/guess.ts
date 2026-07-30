/**
 * Human-facing item tags (shoes, sneakers, …) — distinct from categories
 * (clothing) and from invisible search_tags synonyms.
 */

export function slugifyTagName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function normalizeTagLabel(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2 || cleaned.length > 40) return null;
  if (!/[a-z0-9]/i.test(cleaned)) return null;
  // Title-ish: keep simple lowercase for consistency in rails/search.
  return cleaned.toLowerCase();
}

/** Cap how many tags we attach per line at ingest. */
export const MAX_ITEM_TAGS = 5;

/**
 * Deterministic tag suggestions from a product title.
 * Returns short labels; category stays separate (shoes → tag, clothing → category).
 */
export function guessItemTags(input: {
  name: string;
  variant?: string | null;
  categorySlug?: string | null;
  modelTags?: readonly string[] | null;
}): string[] {
  const blob = `${input.name} ${input.variant ?? ''}`.toLowerCase();
  const tags = new Set<string>();

  for (const raw of input.modelTags ?? []) {
    const label = normalizeTagLabel(raw);
    if (label) tags.add(label);
  }

  const rules: Array<{ re: RegExp; tag: string }> = [
    { re: /\b(sneakers?|trainers?|kicks)\b/, tag: 'sneakers' },
    { re: /\b(boots?|booties)\b/, tag: 'boots' },
    { re: /\b(sandals?|flip[- ]?flops?)\b/, tag: 'sandals' },
    { re: /\b(heels?|pumps?)\b/, tag: 'heels' },
    { re: /\b(shoes?|footwear)\b/, tag: 'shoes' },
    { re: /\b(shirt|tee|t-shirt|blouse)\b/, tag: 'shirts' },
    { re: /\b(pants?|trousers|jeans|chinos)\b/, tag: 'pants' },
    { re: /\b(dress(es)?)\b/, tag: 'dresses' },
    { re: /\b(hoodie|sweatshirt)\b/, tag: 'hoodies' },
    { re: /\b(jacket|coat|parka)\b/, tag: 'jackets' },
    { re: /\b(hat|cap|beanie)\b/, tag: 'hats' },
    { re: /\b(socks?)\b/, tag: 'socks' },
    { re: /\b(lipstick|lip gloss|mascara|foundation|blush|eyeliner|eyeshadow)\b/, tag: 'makeup' },
    { re: /\b(serum|moisturizer|cleanser|toner|sunscreen|skincare)\b/, tag: 'skincare' },
    { re: /\b(headphones?|earbuds?|earphones?|airpods)\b/, tag: 'headphones' },
    { re: /\b(laptop|macbook|notebook computer)\b/, tag: 'laptops' },
    { re: /\b(iphone|smartphone|android phone)\b/, tag: 'phones' },
    { re: /\b(book|novel|paperback|hardcover|kindle)\b/, tag: 'books' },
    { re: /\b(pan|skillet|saucepan|dutch oven)\b/, tag: 'cookware' },
    { re: /\b(vitamin|supplement|multivitamin)\b/, tag: 'supplements' },
  ];

  for (const rule of rules) {
    if (rule.re.test(blob)) tags.add(rule.tag);
  }

  // Prefer specific footwear tags; still keep "shoes" as a parent-ish tag.
  if (
    tags.has('sneakers') ||
    tags.has('boots') ||
    tags.has('sandals') ||
    tags.has('heels')
  ) {
    tags.add('shoes');
  }

  return [...tags]
    .filter((tag) => tag.length >= 2)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_ITEM_TAGS);
}
