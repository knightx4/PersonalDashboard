import { describe, expect, it } from 'vitest';
import {
  applyDiff,
  countChangedLines,
  diffAnchorLines,
  diffFits,
  diffLines,
  MAX_CHANGED_LINES,
  rebaseDiff,
  sectionsTouched,
} from './changes';

function diffOf(added: number, removed = 0): string {
  return [
    'diff --git a/docs/X.md b/docs/X.md',
    'index 1111111..2222222 100644',
    '--- a/docs/X.md',
    '+++ b/docs/X.md',
    `@@ -1,${removed + 1} +1,${added + 1} @@`,
    ' context',
    ...Array.from({ length: removed }, (_, i) => `-old ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i}`),
  ].join('\n');
}

describe('countChangedLines', () => {
  it('counts added and removed lines, not the file headers', () => {
    expect(countChangedLines(diffOf(3, 2))).toBe(5);
  });

  it('counts a removed line that itself starts with two dashes', () => {
    const diff = ['--- a/x', '+++ b/x', '@@ -1 +1 @@', '--- a rule', '+-- a rule'].join('\n');
    expect(countChangedLines(diff)).toBe(2);
  });

  it('skips the headers of a second file in the same diff', () => {
    expect(countChangedLines(`${diffOf(1)}\n${diffOf(2)}`)).toBe(3);
  });

  it('counts nothing before the first hunk', () => {
    expect(countChangedLines('+not a hunk\n-nor this')).toBe(0);
  });
});

describe('diffFits', () => {
  it('takes 60 changed lines and refuses 61', () => {
    expect(diffFits(diffOf(MAX_CHANGED_LINES))).toBe(true);
    expect(diffFits(diffOf(30, 31))).toBe(false);
  });

  it('refuses a diff that changes nothing', () => {
    expect(diffFits(diffOf(0))).toBe(false);
  });
});

describe('diffLines', () => {
  it('drops the file headers and reads each line by its marker', () => {
    const diff = [
      'diff --git a/docs/X.md b/docs/X.md',
      'index 1111111..2222222 100644',
      '--- a/docs/X.md',
      '+++ b/docs/X.md',
      '@@ -3,2 +3,2 @@ ## Part 3',
      ' kept',
      '-old line',
      '+new line',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    expect(diffLines(diff)).toEqual([
      { kind: 'hunk', text: '## Part 3' },
      { kind: 'context', text: 'kept' },
      { kind: 'remove', text: 'old line' },
      { kind: 'add', text: 'new line' },
    ]);
  });

  it('keeps a removed line that starts with two dashes', () => {
    const diff = ['--- a/x', '+++ b/x', '@@ -1 +1 @@', '--- a rule', '+-- a rule'].join('\n');
    expect(diffLines(diff)).toEqual([
      { kind: 'hunk', text: '' },
      { kind: 'remove', text: '-- a rule' },
      { kind: 'add', text: '-- a rule' },
    ]);
  });

  it('shows as many changed lines as it counts', () => {
    const diff = ['--- a/x', '+++ b/x', '@@ -1,2 +1,3 @@', ' a', '-b', '+c', '+d'].join('\n');
    const changed = diffLines(diff).filter((line) => line.kind === 'add' || line.kind === 'remove');
    expect(changed).toHaveLength(countChangedLines(diff));
  });
});

describe('rebaseDiff', () => {
  const spec = ['# Title', '', '## One', '', 'First rule.', 'Second rule.', '', '## Two', '', 'Third rule.', ''].join('\n');

  it('rewrites a hunk header from where its lines are in the spec', () => {
    const drafted = ['--- a/docs/X.md', '+++ b/docs/X.md', '@@ -1,2 +1,2 @@ ## One', ' First rule.', '-Second rule.', '+Second rule, reworded.'].join('\n');
    const result = rebaseDiff(drafted, spec);
    expect(result).toEqual({
      ok: true,
      diff: ['--- a/docs/X.md', '+++ b/docs/X.md', '@@ -5,2 +5,2 @@ ## One', ' First rule.', '-Second rule.', '+Second rule, reworded.', ''].join('\n'),
    });
  });

  it('carries the line count of an earlier hunk into a later one', () => {
    const drafted = ['@@ @@', ' First rule.', '+A new rule.', '@@ @@', '-Third rule.', '+Third rule, changed.'].join('\n');
    const result = rebaseDiff(drafted, spec);
    expect(result.ok && result.diff.split('\n').filter((line) => line.startsWith('@@'))).toEqual([
      '@@ -5 +5,2 @@',
      '@@ -10 +11 @@',
    ]);
  });

  it('puts the spec own wording back on a line drafted with its trailing space lost', () => {
    const withSpace = spec.replace('First rule.', 'First rule.  ');
    const result = rebaseDiff(['@@ @@', ' First rule.', '+Added.'].join('\n'), withSpace);
    expect(result.ok && result.diff).toContain(' First rule.  \n');
  });

  it('refuses a diff whose lines are not in the spec', () => {
    const result = rebaseDiff(['@@ @@', '-A rule nobody wrote.', '+Something.'].join('\n'), spec);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.why).toContain('A rule nobody wrote.');
  });

  it('refuses a diff with no hunks', () => {
    expect(rebaseDiff('Make the rule shorter.', spec).ok).toBe(false);
  });

  it('takes a diff that writes a new spec from nothing', () => {
    const result = rebaseDiff(['@@ @@', '+# New', '+', '+A rule.'].join('\n'), null);
    expect(result.ok && result.diff.split('\n')[0]).toBe('@@ -0,0 +1,3 @@');
  });

  it('keeps the count the database makes', () => {
    const drafted = ['@@ @@', ' First rule.', '-Second rule.', '+Second rule, reworded.'].join('\n');
    const result = rebaseDiff(drafted, spec);
    expect(result.ok && countChangedLines(result.diff)).toBe(2);
  });
});

describe('diffAnchorLines', () => {
  it('names the lines a diff removes or stands beside, not what it adds', () => {
    expect(diffAnchorLines(['@@ @@', ' First rule.', '-Second rule.', '+New.', ' '].join('\n'))).toEqual([
      'First rule.',
      'Second rule.',
    ]);
  });
});

describe('sectionsTouched', () => {
  const spec = ['# Title', '', '## One', '', 'First rule.', '', '## Two', '', 'Second rule.', ''].join('\n');

  it('picks the section holding the lines the diff changes', () => {
    const touched = sectionsTouched(spec, ['@@ @@', '-Second rule.', '+Changed.'].join('\n'));
    expect(touched.map((section) => section.heading)).toEqual(['Two']);
  });

  it('falls back to every section when none can be told apart, and none for a new spec', () => {
    expect(sectionsTouched(spec, ['@@ @@', '+Only added.'].join('\n'))).toHaveLength(2);
    expect(sectionsTouched(null, ['@@ @@', '+Only added.'].join('\n'))).toEqual([]);
  });
});

describe('applyDiff', () => {
  const spec = ['# Title', '', '## One', '', 'First rule.', 'Second rule.', '', '## Two', '', 'Third rule.', ''].join('\n');

  it('writes every hunk into the spec, wherever its line numbers said it was', () => {
    const drafted = ['@@ -1 +1 @@', ' First rule.', '+A new rule.', '@@ -2 +2 @@', '-Third rule.', '+Third rule, changed.'].join('\n');
    const result = applyDiff(drafted, spec);
    expect(result.ok && result.markdown).toBe(
      ['# Title', '', '## One', '', 'First rule.', 'A new rule.', 'Second rule.', '', '## Two', '', 'Third rule, changed.', ''].join('\n'),
    );
    expect(result.ok && result.diff).toContain('@@ -10 +11 @@');
  });

  it('removes lines without leaving a gap', () => {
    const result = applyDiff(['@@ @@', ' First rule.', '-Second rule.'].join('\n'), spec);
    expect(result.ok && result.markdown).toBe(spec.replace('Second rule.\n', ''));
  });

  it('writes a new spec from nothing, ending in a newline', () => {
    const result = applyDiff(['@@ @@', '+# New', '+', '+A rule.'].join('\n'), null);
    expect(result.ok && result.markdown).toBe('# New\n\nA rule.\n');
  });

  it('refuses a diff whose lines have left the spec, writing nothing', () => {
    const result = applyDiff(['@@ @@', '-A rule nobody wrote.', '+Something.'].join('\n'), spec);
    expect(result.ok).toBe(false);
  });
});
