import { describe, expect, it } from 'vitest';
import { cn } from './cn';

/**
 * A size and a colour are both spelled `text-*`, and tailwind-merge cannot
 * tell them apart without being told about this project's scales. Left
 * untold, it treated `text-surface` and `text-body` as the same kind of class
 * and deleted the first -- which rendered the primary button's label in the
 * inherited colour and made it invisible in three of the four themes.
 */
describe('cn', () => {
  it('keeps a text colour and a text size together', () => {
    expect(cn('bg-accent text-surface', 'h-10 px-4 text-body')).toContain('text-surface');
    expect(cn('bg-accent text-surface', 'h-10 px-4 text-body')).toContain('text-body');
  });

  it('still lets a later size win over an earlier one', () => {
    const result = cn('text-ui', 'text-body');
    expect(result).toBe('text-body');
  });

  it('still lets a later colour win over an earlier one', () => {
    const result = cn('text-ink-muted', 'text-accent');
    expect(result).toBe('text-accent');
  });

  it('separates background, border and text colours', () => {
    const result = cn('bg-surface text-ink border-border');
    expect(result).toBe('bg-surface text-ink border-border');
  });

  it('resolves conflicts within one property', () => {
    expect(cn('bg-surface', 'bg-sunken')).toBe('bg-sunken');
    expect(cn('border-border', 'border-control')).toBe('border-control');
  });
});
