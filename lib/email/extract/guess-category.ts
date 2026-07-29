import type { CategoryOption } from '@/lib/email/extract/schema';

/** Cheap deterministic category guesses when LLM is unavailable. */
export function guessCategorySlug(input: {
  name: string;
  merchantSlug?: string | null;
  subject?: string | null;
  text?: string | null;
  /** User-created categories — preferred when the name clearly matches. */
  customCategories?: readonly CategoryOption[];
}): string | null {
  const blob = `${input.name} ${input.subject ?? ''} ${input.text ?? ''}`.toLowerCase();

  for (const category of input.customCategories ?? []) {
    const label = category.name.trim().toLowerCase();
    if (label.length < 3) continue;
    if (blob.includes(label)) return category.slug;
    const tokens = label.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
    if (tokens.length > 0 && tokens.every((token) => blob.includes(token))) {
      return category.slug;
    }
  }

  if (/\b(book|novel|paperback|hardcover|kindle|audiobook|isbn)\b/.test(blob)) {
    return 'books';
  }
  if (/\b(iphone|ipad|macbook|usb|hdmi|charger|cable|laptop|headphone|earbuds|ssd|gpu)\b/.test(blob)) {
    return 'electronics';
  }
  if (/\b(shirt|pants|jeans|dress|hoodie|sneakers|shoes|jacket|socks|hat|cap|tee)\b/.test(blob)) {
    return 'clothing';
  }
  if (/\b(dog|cat|pet |litter|kibble)\b/.test(blob)) return 'pet';
  if (/\b(foam|foamer|cleanser|serum|moisturizer|shampoo|toothpaste|vitamin|supplement)\b/.test(blob)) {
    return /\b(vitamin|supplement)\b/.test(blob) ? 'health' : 'beauty';
  }
  if (/\b(grocery|organic|snack|coffee beans|olive oil)\b/.test(blob)) return 'groceries';
  if (/\b(sofa|chair|desk|lamp|pillow|towel|pan|knife|mug)\b/.test(blob)) return 'home';
  return null;
}
