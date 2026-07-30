import { describe, expect, it } from 'vitest';
import { guessItemTags, normalizeTagLabel, slugifyTagName } from './guess';

describe('guessItemTags', () => {
  it('tags shoes while leaving category to clothing separately', () => {
    const tags = guessItemTags({
      name: 'Nike Air Max 90 Men\'s Shoes',
      categorySlug: 'clothing',
    });
    expect(tags).toContain('shoes');
    expect(tags).not.toContain('clothing');
  });

  it('adds sneakers + shoes for sneaker titles', () => {
    const tags = guessItemTags({ name: 'Adidas Samba OG Sneakers' });
    expect(tags).toContain('sneakers');
    expect(tags).toContain('shoes');
  });

  it('keeps model tags when provided', () => {
    const tags = guessItemTags({
      name: 'Something vague',
      modelTags: ['Trail Running', 'shoes'],
    });
    expect(tags).toContain('trail running');
    expect(tags).toContain('shoes');
  });
});

describe('normalizeTagLabel / slugifyTagName', () => {
  it('normalizes labels', () => {
    expect(normalizeTagLabel('  Shoes  ')).toBe('shoes');
    expect(normalizeTagLabel('a')).toBeNull();
    expect(slugifyTagName('Trail Running')).toBe('trail-running');
  });
});
