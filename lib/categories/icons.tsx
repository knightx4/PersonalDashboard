import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Box,
  HeartPulse,
  House,
  PawPrint,
  Puzzle,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  UtensilsCrossed,
} from 'lucide-react';
import { createElement } from 'react';

/** Top-level system category slug → icon. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  clothing: Shirt,
  electronics: Smartphone,
  home: House,
  kitchen: UtensilsCrossed,
  beauty: Sparkles,
  health: HeartPulse,
  groceries: ShoppingBasket,
  hobby: Puzzle,
  pet: PawPrint,
  books: BookOpen,
  other: Box,
};

export function categoryIcon(slug: string | null | undefined): LucideIcon {
  if (!slug) return Box;
  return CATEGORY_ICONS[slug] ?? Box;
}

/** Render a category icon without creating a component type during render. */
export function CategoryGlyph({
  slug,
  className,
  strokeWidth = 1.75,
}: {
  slug?: string | null;
  className?: string;
  strokeWidth?: number;
}) {
  return createElement(categoryIcon(slug), {
    className,
    strokeWidth,
    'aria-hidden': true,
  });
}
