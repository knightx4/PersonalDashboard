/**
 * Retail synonym groups + tag derivation for smart inventory search.
 * "makeup" should find lipstick even when neither word is in the title.
 */

/** Canonical tag → related tags (including itself). Lowercase tokens only. */
export const SYNONYM_GROUPS: Readonly<Record<string, readonly string[]>> = {
  makeup: [
    'makeup',
    'cosmetics',
    'beauty',
    'lipstick',
    'lipgloss',
    'mascara',
    'foundation',
    'concealer',
    'blush',
    'bronzer',
    'eyeliner',
    'eyeshadow',
    'primer',
    'skincare',
    'serum',
    'moisturizer',
    'cleanser',
  ],
  lipstick: ['lipstick', 'lip', 'lipgloss', 'lipliner', 'makeup', 'beauty', 'cosmetics'],
  skincare: [
    'skincare',
    'serum',
    'moisturizer',
    'cleanser',
    'toner',
    'sunscreen',
    'beauty',
    'face',
  ],
  sneakers: ['sneakers', 'shoes', 'kicks', 'trainers', 'footwear', 'clothing'],
  shoes: ['shoes', 'sneakers', 'boots', 'sandals', 'heels', 'footwear', 'clothing'],
  laptop: ['laptop', 'notebook', 'computer', 'macbook', 'chromebook', 'electronics'],
  headphones: ['headphones', 'earbuds', 'earphones', 'airpods', 'headset', 'electronics'],
  phone: ['phone', 'iphone', 'smartphone', 'android', 'electronics'],
  kitchen: [
    'kitchen',
    'cookware',
    'bakeware',
    'utensil',
    'pan',
    'skillet',
    'knife',
    'cutting',
    'mug',
    'plate',
    'bowl',
    'appliance',
  ],
  cookware: ['cookware', 'pan', 'skillet', 'pot', 'dutch', 'kitchen'],
  furniture: ['furniture', 'sofa', 'chair', 'desk', 'table', 'home'],
  book: ['book', 'books', 'novel', 'paperback', 'hardcover', 'kindle', 'audiobook'],
  grocery: ['grocery', 'groceries', 'food', 'snack', 'pantry'],
  pet: ['pet', 'dog', 'cat', 'kibble', 'litter'],
  vitamin: ['vitamin', 'supplement', 'health', 'multivitamin'],
  clothing: [
    'clothing',
    'shirt',
    'pants',
    'jeans',
    'dress',
    'hoodie',
    'jacket',
    'socks',
    'hat',
    'apparel',
  ],
};

const TOKEN_RE = /[a-z0-9]+(?:'[a-z0-9]+)?/g;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length >= 2);
}

/** Expand a user query into tags/terms for matching. */
export function expandSearchQuery(query: string): string[] {
  const tokens = tokenize(query);
  const out = new Set<string>();
  for (const token of tokens) {
    out.add(token);
    const group = SYNONYM_GROUPS[token];
    if (group) {
      for (const tag of group) out.add(tag);
    }
    // Also match tokens that appear inside any group.
    for (const [canonical, members] of Object.entries(SYNONYM_GROUPS)) {
      if (members.includes(token)) {
        out.add(canonical);
        for (const tag of members) out.add(tag);
      }
    }
  }
  return [...out].slice(0, 40);
}

/**
 * Build search tags for an inventory item from its title, category, and
 * optional model-provided tags.
 */
export function buildSearchTags(input: {
  name: string;
  shortName?: string | null;
  variant?: string | null;
  categorySlug?: string | null;
  categoryName?: string | null;
  modelTags?: readonly string[] | null;
}): string[] {
  const tags = new Set<string>();

  for (const raw of input.modelTags ?? []) {
    for (const token of tokenize(raw)) tags.add(token);
  }

  const blob = [input.name, input.shortName, input.variant, input.categoryName, input.categorySlug]
    .filter(Boolean)
    .join(' ');
  const tokens = tokenize(blob);

  for (const token of tokens) {
    tags.add(token);
    const group = SYNONYM_GROUPS[token];
    if (group) {
      for (const tag of group) tags.add(tag);
    }
    for (const [canonical, members] of Object.entries(SYNONYM_GROUPS)) {
      if (members.includes(token)) {
        tags.add(canonical);
        // Add a tighter subset: canonical + the matched token's close peers.
        for (const tag of members.slice(0, 8)) tags.add(tag);
      }
    }
  }

  if (input.categorySlug) {
    for (const token of tokenize(input.categorySlug.replace(/-/g, ' '))) {
      tags.add(token);
    }
  }

  // Cap to keep rows small; prefer shorter/more distinctive tags.
  return [...tags]
    .filter((tag) => tag.length >= 2 && tag.length <= 32)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, 48);
}
