import { describe, expect, it } from 'vitest';
import { anchorFor, splitSections } from '@/lib/specs/sections';
import { SPECS, groupSpecs, type SpecDoc } from '@/lib/specs/registry';

/**
 * The anchor is a key in the database. Change how one is derived and every
 * comment already filed is orphaned, so these are the tests that stop a tidy-up
 * quietly throwing away a conversation.
 */

describe('anchorFor', () => {
  it('lowercases and hyphenates', () => {
    expect(anchorFor('What an edge is')).toBe('what-an-edge-is');
  });

  it('drops the punctuation these documents are full of', () => {
    expect(anchorFor('Zoom — compute it, don’t store it')).toBe('zoom-compute-it-dont-store-it');
    expect(anchorFor('Subjects are labels, not containers')).toBe(
      'subjects-are-labels-not-containers',
    );
  });

  it('drops inline markdown, so styling a heading does not move it', () => {
    expect(anchorFor('The `requires` edge')).toBe('the-requires-edge');
    expect(anchorFor('**Bold** heading')).toBe('bold-heading');
  });

  it('keeps digits and collapses runs of spaces', () => {
    expect(anchorFor('Stage 0  —  Classify')).toBe('stage-0-classify');
  });
});

describe('splitSections', () => {
  it('cuts on top-level headings only', () => {
    const sections = splitSections(['## One', 'a', '### Deeper', 'b', '## Two', 'c'].join('\n'));
    expect(sections.map((s) => s.heading)).toEqual(['One', 'Two']);
    expect(sections[0].body).toContain('### Deeper');
  });

  it('keeps the preamble, because that is where the argument opens', () => {
    const sections = splitSections(['# Title', '', 'Why this exists.', '', '## One', 'a'].join('\n'));
    expect(sections[0].anchor).toBe('opening');
    expect(sections[0].body).toBe('Why this exists.');
    // The title is dropped: the page prints the document's name already.
    expect(sections[0].body).not.toContain('# Title');
  });

  it('has no opening section when the document starts on a heading', () => {
    const sections = splitSections(['# Title', '## One', 'a'].join('\n'));
    expect(sections.map((s) => s.anchor)).toEqual(['one']);
  });

  it('ignores a heading inside a code fence', () => {
    const sections = splitSections(
      ['## Real', '```', '## Not a heading', '```', 'after'].join('\n'),
    );
    expect(sections.map((s) => s.heading)).toEqual(['Real']);
    expect(sections[0].body).toContain('## Not a heading');
  });

  it('disambiguates a heading used twice', () => {
    // BUILD-ORDER.md really does carry "Ordering notes worth respecting" twice.
    const sections = splitSections(['## Notes', 'a', '## Notes', 'b'].join('\n'));
    expect(sections.map((s) => s.anchor)).toEqual(['notes', 'notes-2']);
  });

  it('keeps an empty section, since the heading is itself a claim', () => {
    const sections = splitSections(['## Empty', '', '## Next', 'a'].join('\n'));
    expect(sections.map((s) => s.anchor)).toEqual(['empty', 'next']);
    expect(sections[0].body).toBe('');
  });

  it('positions in reading order, spaced so one can be slotted between', () => {
    const sections = splitSections(['## A', 'x', '## B', 'y', '## C', 'z'].join('\n'));
    expect(sections.map((s) => s.position)).toEqual([0, 10, 20]);
  });

  it('returns nothing for an empty document', () => {
    expect(splitSections('')).toEqual([]);
  });
});

describe('groupSpecs', () => {
  const spec = (slug: string, module: SpecDoc['module']): SpecDoc => ({
    slug,
    title: slug,
    blurb: '',
    file: `${slug.toUpperCase()}.md`,
    module,
  });

  const moduleOf = (module: string | null) => (group: { module: string | null }) =>
    group.module === module;

  it('follows MODULES order and puts the app-wide group last', () => {
    const groups = groupSpecs([
      spec('a', null),
      spec('b', 'learn'),
      spec('c', 'shopping'),
    ]);
    const modules = groups.map((group) => group.module);
    expect(modules[modules.length - 1]).toBeNull();
    expect(modules.indexOf('shopping')).toBeLessThan(modules.indexOf('learn'));
    expect(groups[groups.length - 1].label).toBe('The app as a whole');
  });

  it('keeps a workspace with no spec, because its vision is written there', () => {
    const groups = groupSpecs([spec('a', 'learn')]);
    const todo = groups.find(moduleOf('todo'));
    expect(todo).toBeDefined();
    expect(todo?.specs).toEqual([]);
  });

  it('leaves out the app-wide group when nothing is filed under it', () => {
    expect(groupSpecs([spec('a', 'learn')]).some(moduleOf(null))).toBe(false);
  });

  it('sums the comments on a group, which is what the folded row shows', () => {
    const groups = groupSpecs([spec('a', 'learn'), spec('b', 'learn')], { a: 3, b: 4 });
    expect(groups.find(moduleOf('learn'))?.comments).toBe(7);
  });

  it('counts zero for specs nobody has commented on', () => {
    const groups = groupSpecs([spec('a', 'learn')], { somethingElse: 9 });
    expect(groups.find(moduleOf('learn'))?.comments).toBe(0);
  });

  it('groups every real spec, so none can go missing from the page', () => {
    const grouped = groupSpecs(SPECS).flatMap((group) => group.specs);
    expect(grouped).toHaveLength(SPECS.length);
  });
});
