import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes with later ones winning conflicts.
 *
 * tailwind-merge has to be told about this project's scales, and the reason is
 * not cosmetic. Both a font size and a text colour are spelled `text-*`, so
 * with the default config `text-surface` and `text-body` looked like the same
 * kind of class and the later one silently deleted the earlier -- which is how
 * the primary button lost its label colour and rendered white-on-lavender.
 *
 * Any new named scale added to globals.css belongs in this list too.
 */
const TEXT_SIZES = [
  'micro',
  'small',
  'ui',
  'body',
  'lead',
  'title',
  'figure',
  'figure-lg',
  'figure-xl',
] as const;

const COLOURS = [
  'canvas',
  'surface',
  'raised',
  'sunken',
  'border',
  'border-strong',
  'control',
  'ink',
  'ink-muted',
  'ink-ghost',
  'accent',
  'accent-hover',
  'accent-tint',
  'w-shopping',
  'w-shopping-tint',
  'w-jobs',
  'w-jobs-tint',
  'w-todo',
  'w-todo-tint',
  'w-vault',
  'w-vault-tint',
  'w-learn',
  'w-learn-tint',
  'w-dev',
  'w-dev-tint',
  'page',
  'shell',
  'shell-ink',
  'shell-muted',
  'shell-border',
  'shell-hover',
  'positive',
  'positive-tint',
  'caution',
  'caution-fill',
  'caution-tint',
  'danger',
  'danger-tint',
  ...(
    ['lead', 'submitted', 'process', 'final', 'offer', 'rejected', 'ghosted'] as const
  ).flatMap((stage) => [`status-${stage}`, `status-${stage}-tint`]),
] as const;

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TEXT_SIZES] }],
      'text-color': [{ text: [...COLOURS] }],
      'bg-color': [{ bg: [...COLOURS] }],
      'border-color': [{ border: [...COLOURS] }],
      'ring-color': [{ ring: [...COLOURS] }],
      'divide-color': [{ divide: [...COLOURS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
