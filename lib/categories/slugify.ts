/** Shared category slug helper for system + user-owned categories. */

export function slugifyCategoryName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const CATEGORY_COLOR_OPTIONS = [
  '#6A82FB',
  '#4A9DD4',
  '#FF8A4C',
  '#FF6B9D',
  '#3FA37A',
  '#C9A227',
  '#9B72CF',
  '#E2725B',
  '#5B8C5A',
  '#2F6F6A',
  '#6B6B66',
] as const;

export type CategoryColor = (typeof CATEGORY_COLOR_OPTIONS)[number];

export function isCategoryColor(value: string): value is CategoryColor {
  return (CATEGORY_COLOR_OPTIONS as readonly string[]).includes(value);
}

/** Pick the next unused palette color for a new custom category. */
export function pickCategoryColor(existingColors: readonly (string | null | undefined)[]): CategoryColor {
  const used = new Set(
    existingColors.filter((color): color is string => Boolean(color)),
  );
  for (const color of CATEGORY_COLOR_OPTIONS) {
    if (!used.has(color)) return color;
  }
  return CATEGORY_COLOR_OPTIONS[existingColors.length % CATEGORY_COLOR_OPTIONS.length]!;
}
