import { describe, expect, it } from 'vitest';
import { applyDiff, countChangedLines, rebaseDiff } from './changes';
import {
  draftCandidates,
  draftFits,
  draftVisionNote,
  draftWhy,
  interviewCitation,
  newSpecTarget,
  specChangeHref,
  specDraftDiff,
  visionDraftHref,
} from './interview-draft';
import { parseRules } from './rules';

/**
 * A drafted spec as the diff it becomes (plan #1640): a new spec for a
 * workspace with none, an addition to the spec a workspace has, and the
 * app's own spec. Every diff is applied with the same code that approving
 * uses, so what is tested is what the approve flow will write.
 */

const SPECS = [
  { slug: 'todo', title: 'Todo', file: 'TODO-SPEC.md', module: 'todo' },
  { slug: 'learn', title: 'Learn: the reading queue', file: 'LEARN-SPEC.md', module: 'learn' },
  { slug: 'learn-map', title: 'The map', file: 'LEARN-MAP-SPEC.md', module: 'learn' },
  { slug: 'writing', title: 'Professional writing guide', file: 'WRITING-GUIDE.md', module: null },
];

const DRAFT = {
  sections: [
    { heading: 'What it is for', body: 'The weekly shop and the errands around it.' },
    { heading: '## Routines:', body: '- A list on Saturday morning.\n\n\n- Checked off in the shop.' },
  ],
  rules: ['Every item on the list says which shop it comes from.', '**R9.** Nothing is bought twice in a week.'],
};

describe('where a draft goes', () => {
  it('creates a spec for a workspace with none, named by its id', () => {
    expect(draftCandidates('shopping', SPECS)).toEqual([]);
    expect(newSpecTarget('shopping', SPECS)).toEqual({ slug: 'shopping', file: 'SHOPPING-SPEC.md', title: null });
  });

  it('offers the workspace its own specs', () => {
    expect(draftCandidates('learn', SPECS).map((c) => c.slug)).toEqual(['learn', 'learn-map']);
  });

  it('gives the app its own spec rather than the app-wide ones', () => {
    expect(draftCandidates('app', SPECS)).toEqual([]);
    expect(newSpecTarget('app', SPECS)).toEqual({ slug: 'app', file: 'APP-SPEC.md', title: null });
    const withApp = [...SPECS, { slug: 'app', title: 'The app', file: 'APP-SPEC.md', module: null }];
    expect(draftCandidates('app', withApp).map((c) => c.slug)).toEqual(['app']);
  });

  it('does not take a slug another spec has', () => {
    expect(newSpecTarget('todo', SPECS).slug).toBe('todo-workspace');
  });
});

describe('specDraftDiff', () => {
  it('writes a new spec with its rules checked by the audit', () => {
    const diff = specDraftDiff({
      target: newSpecTarget('shopping', SPECS),
      markdown: null,
      heading: 'Shopping',
      draft: DRAFT,
    });
    expect(diff.split('\n').slice(0, 2)).toEqual(['--- /dev/null', '+++ b/docs/SHOPPING-SPEC.md']);
    const applied = applyDiff(diff, null);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.markdown).toBe(
      [
        '# Shopping',
        '',
        '## What it is for',
        '',
        'The weekly shop and the errands around it.',
        '',
        '## Routines',
        '',
        '- A list on Saturday morning.',
        '',
        '- Checked off in the shop.',
        '',
        '## Rules',
        '',
        '**R1.** Every item on the list says which shop it comes from.',
        'Checked by: audit.',
        '',
        '**R2.** Nothing is bought twice in a week.',
        'Checked by: audit.',
        '',
      ].join('\n'),
    );
    expect(parseRules(applied.markdown).rules.map((r) => [r.number, r.check])).toEqual([
      [1, { kind: 'audit' }],
      [2, { kind: 'audit' }],
    ]);
    expect(countChangedLines(diff)).toBe(19);
    expect(draftFits(diff)).toEqual({ ok: true });
  });

  it('adds to a spec with a Rules section in the middle, numbering on from its last rule', () => {
    const markdown = [
      '# Todo',
      '',
      'The list.',
      '',
      '## Rules',
      '',
      '**R1.** One list.',
      'Checked by: audit.',
      '',
      '**R2.** Nothing copied.',
      'Checked by: audit.',
      '',
      '## Build order',
      '',
      'First the list.',
      '',
    ].join('\n');
    const target = draftCandidates('todo', SPECS)[0];
    const diff = specDraftDiff({ target, markdown, heading: 'ignored', draft: DRAFT });
    expect(rebaseDiff(diff, markdown).ok).toBe(true);
    const applied = applyDiff(diff, markdown);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const rules = parseRules(applied.markdown).rules;
    expect(rules.map((r) => r.number)).toEqual([1, 2, 3, 4]);
    expect(rules[2].sentence).toBe('Every item on the list says which shop it comes from.');
    // The sections go at the end, after the sections already there.
    expect(applied.markdown.indexOf('## What it is for')).toBeGreaterThan(applied.markdown.indexOf('First the list.'));
    expect(applied.markdown.startsWith('# Todo\n\nThe list.')).toBe(true);
  });

  it('adds a Rules section to a spec that has none', () => {
    const markdown = '# Learn\n\nA queue.\n\n## Reading\n\nItems.\n';
    const target = draftCandidates('learn', SPECS)[0];
    const diff = specDraftDiff({ target, markdown, heading: 'ignored', draft: DRAFT });
    const applied = applyDiff(diff, markdown);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.markdown.startsWith(markdown.trimEnd())).toBe(true);
    expect(parseRules(applied.markdown).rules.map((r) => r.number)).toEqual([1, 2]);
  });

  it('places the addition at the end even when the last lines repeat earlier ones', () => {
    const markdown = '# Todo\n\nSee below.\n\n---\n\n## A\n\nSee below.\n\n---\n';
    const target = draftCandidates('todo', SPECS)[0];
    const diff = specDraftDiff({ target, markdown, heading: 'ignored', draft: DRAFT });
    const applied = applyDiff(diff, markdown);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.markdown.startsWith(markdown.trimEnd())).toBe(true);
  });

  it('says when a draft runs over the 60-line limit', () => {
    const long = { sections: [{ heading: 'Long', body: Array.from({ length: 70 }, (_, i) => `Line ${i}.`).join('\n') }], rules: ['One.'] };
    const diff = specDraftDiff({ target: newSpecTarget('news', SPECS), markdown: null, heading: 'News', draft: long });
    expect(draftFits(diff)).toEqual({ ok: false, lines: countChangedLines(diff) });
  });
});

describe('citing the interview', () => {
  it('names the interview in the why and the note', () => {
    const citation = interviewCitation('Shopping', '2026-10-07');
    expect(citation).toBe('Drafted from your interview about Shopping on 7 October 2026.');
    expect(draftWhy(citation, 'You said "the weekly shop".')).toBe(`${citation} You said "the weekly shop".`);
    expect(draftWhy(citation, 'x'.repeat(3000)).length).toBe(2000);
    expect(draftVisionNote({ citation, why: 'From your first answer.', foldedFrom: '2026-10-04T08:00:00Z' })).toBe(
      `${citation} From your first answer. It takes the place of the edit the weekly review proposed on 4 October 2026, and keeps what still held of it.`,
    );
  });

  it('links to where each proposal waits', () => {
    expect(visionDraftHref('shopping')).toBe('/dev/specs#vision-shopping');
    expect(specChangeHref('c1')).toBe('/dev/specs#spec-change-c1');
  });
});
