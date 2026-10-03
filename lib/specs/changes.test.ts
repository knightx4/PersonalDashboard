import { describe, expect, it } from 'vitest';
import { countChangedLines, diffFits, diffLines, MAX_CHANGED_LINES } from './changes';

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
