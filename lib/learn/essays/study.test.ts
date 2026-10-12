import { describe, expect, it } from 'vitest';
import {
  bestSentence,
  briefSearchText,
  clip,
  contentWords,
  linkText,
  originLine,
  paragraphNear,
  passageItem,
  passageKey,
  pinItems,
  pinKey,
  positionItem,
  quoteSource,
  quoteText,
  SENTENCE_MAX,
  sentences,
  STUDY_SHOWN,
  studyList,
  wikilinkTarget,
  wordMatches,
  type StudyItem,
  type WordCandidate,
} from './study';

const PARAGRAPH =
  'Money is the odd good out because every market prices things in it, so a market for money itself has no outside measure.';

function item(key: string, extra: Partial<StudyItem> = {}): StudyItem {
  return {
    key,
    kind: 'reading',
    title: key,
    context: null,
    sentence: 's',
    href: null,
    link: null,
    pinned: false,
    ...extra,
  };
}

describe('contentWords', () => {
  it('keeps the words that say what a text is about, stemmed', () => {
    const words = contentWords('The markets priced money; markets are about money.');
    expect(words.has('market')).toBe(true);
    expect(words.has('money')).toBe(true);
    expect(words.has('pric')).toBe(true);
    expect(words.has('about')).toBe(false);
    expect(words.has('the')).toBe(false);
  });
});

describe('sentences', () => {
  it('splits at sentence ends and drops list and quote markers', () => {
    expect(sentences('- First point. Second point!\n> A quote here')).toEqual([
      'First point.',
      'Second point!',
      'A quote here',
    ]);
  });
});

describe('bestSentence', () => {
  it('picks the sentence sharing the most words with the paragraph', () => {
    const found = bestSentence(contentWords(PARAGRAPH), [
      'Walzer writes about spheres. Money is a market good that prices every other market.',
    ]);
    expect(found?.sentence).toBe('Money is a market good that prices every other market.');
    expect(found?.shared).toBeGreaterThanOrEqual(3);
  });

  it('is null with nothing to read', () => {
    expect(bestSentence(contentWords(PARAGRAPH), [null, '', undefined])).toBeNull();
  });
});

describe('clip', () => {
  it('cuts a long sentence at a word with an ellipsis', () => {
    const long = 'word '.repeat(100).trim();
    const cut = clip(long);
    expect(cut.length).toBeLessThanOrEqual(SENTENCE_MAX + 1);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('wordMatches', () => {
  const candidates: WordCandidate[] = [
    {
      key: 'reading:1',
      kind: 'reading',
      title: 'Spheres of Justice',
      context: 'ch. 4',
      href: '/learn/r/1',
      link: null,
      texts: ['Money is the one good every market prices. That is why it dominates.'],
    },
    {
      key: 'log:1',
      kind: 'log',
      title: 'Gardening',
      context: null,
      href: null,
      link: null,
      texts: ['Tomatoes want full sun and regular water.'],
    },
  ];

  it('keeps what shares enough words, with the sentence that matched', () => {
    const found = wordMatches(PARAGRAPH, candidates);
    expect(found.map((f) => f.key)).toEqual(['reading:1']);
    expect(found[0].sentence).toBe('Money is the one good every market prices.');
  });

  it('finds nothing for a paragraph of common words', () => {
    expect(wordMatches('and the of it is', candidates)).toEqual([]);
  });
});

describe('passages and positions', () => {
  it('makes a passage an item with a link to its note and the nearest sentence', () => {
    const passage = passageItem(PARAGRAPH, {
      noteId: 'n1',
      path: 'Ideas/On money.md',
      title: 'On money',
      headingPath: ['Markets'],
      text: '## Markets\nPrices are set in money. Gardens are nice.',
      href: '/vault/notes/Ideas/On%20money.md',
    });
    expect(passage.key).toBe(passageKey('n1', ['Markets']));
    expect(passage.link).toBe('On money');
    expect(passage.sentence).toBe('Prices are set in money.');
    expect(passage.context).toBe('Markets');
    expect(linkText(passage)).toBe('[[On money]]');
    expect(quoteText(passage)).toBe('“Prices are set in money.”');
    expect(quoteSource(passage)).toBe('On money');
  });

  it('makes a position an item with its checked quote and its theme', () => {
    const position = positionItem({
      positionId: 'p1',
      name: 'Money dominates',
      statement: 'Money buys what should not be for sale.',
      themeId: 't1',
      path: 'Reading/Walzer.md',
      quote: 'Money is the universal pander.',
    });
    expect(position.href).toBe('/vault/map/t1');
    expect(position.sentence).toBe('Money is the universal pander.');
    expect(position.link).toBe('Walzer');
  });

  it('names a note for a wikilink by its file name', () => {
    expect(wikilinkTarget('Essays/Why money.md')).toBe('Why money');
  });
});

describe('pins', () => {
  it('lists a pin by title, or with its row when the search loaded it', () => {
    const pins = [
      { kind: 'reading' as const, id: 'r1', title: 'Spheres' },
      { kind: 'goal' as const, id: 'g1', title: 'Learn economics' },
    ];
    const loaded = new Map([[pinKey(pins[0]), item('reading:r1', { sentence: 'Matched.' })]]);
    const items = pinItems(pins, loaded);
    expect(items[0]).toMatchObject({ key: 'reading:r1', sentence: 'Matched.', pinned: true });
    expect(items[1]).toMatchObject({
      key: 'goal:g1',
      title: 'Learn economics',
      sentence: null,
      pinned: true,
    });
  });
});

describe('studyList', () => {
  it('puts pins first, interleaves the rest, drops repeats and hidden items, and caps the list', () => {
    const pins = [item('reading:pin', { pinned: true })];
    const passages = [item('passage:a'), item('passage:b'), item('passage:c')];
    const positions = [item('position:a'), item('position:b')];
    const words = [item('reading:pin'), item('log:a'), item('clip:a'), item('card:a')];
    const list = studyList(pins, [passages, positions, words], ['position:b']);
    expect(list[0].key).toBe('reading:pin');
    expect(list.slice(1).map((i) => i.key)).toEqual([
      'passage:a',
      'position:a',
      'passage:b',
      'log:a',
      'passage:c',
      'clip:a',
    ]);
    expect(list.length - 1).toBe(STUDY_SHOWN);
  });
});

describe('paragraphNear', () => {
  const paragraphs = [
    { from: 10, to: 50, text: 'one' },
    { from: 60, to: 100, text: 'two' },
  ];
  it('takes the paragraph the cursor is in', () => {
    expect(paragraphNear(paragraphs, 70)?.text).toBe('two');
  });
  it('takes the one before the cursor on a blank line', () => {
    expect(paragraphNear(paragraphs, 55)?.text).toBe('one');
  });
  it('takes the first from the title', () => {
    expect(paragraphNear(paragraphs, 0)?.text).toBe('one');
  });
  it('is null with no paragraphs', () => {
    expect(paragraphNear([], 0)).toBeNull();
  });
});

describe('the interview', () => {
  it('searches with the question and the answer', () => {
    expect(briefSearchText({ question: ' Why money? ', claim: '' })).toBe('Why money?');
  });
  it('offers a line naming where it came from', () => {
    expect(
      originLine({ kind: 'position', title: 'Money dominates', sentence: 'It buys all.' }),
    ).toBe('Position “Money dominates”: It buys all.');
  });
});
