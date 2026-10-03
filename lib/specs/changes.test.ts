import { describe, expect, it } from 'vitest';
import { countChangedLines, diffFits, MAX_CHANGED_LINES } from './changes';

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
