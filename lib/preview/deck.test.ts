import { describe, expect, it } from 'vitest';
import { DECKS_SCRIPT_ID, readDecks, writeDecks, type Deck } from './deck';

describe('readDecks / writeDecks', () => {
  it('reads back what the gallery index writes, with a selector that holds a <', () => {
    const declared: Record<string, Deck> = {
      'news-quick-story': { next: '#quick-read-next button[type="submit"]', item: '[data-quick-swipe]' },
      odd: { next: 'button[aria-label="</script>"]', item: 'article' },
    };
    const html = `<div><script type="application/json" id="${DECKS_SCRIPT_ID}">${writeDecks(declared)}</script></div>`;
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(readDecks(html)).toEqual(declared);
  });

  it('reads an index with no block as no decks', () => {
    expect(readDecks('<ul></ul>')).toEqual({});
  });
});
