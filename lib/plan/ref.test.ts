import { describe, expect, it } from 'vitest';
import { numberFromRef, readableRefs, refFor, stepRef } from './ref';

const outlines = new Map([
  [1073, '1073'],
  [1081, '1073.1'],
  [1084, '1073.4'],
  [1090, '1073.4.1'],
]);

describe('stepRef', () => {
  it('names a placed step by its outline and an unplaced one by its number', () => {
    expect(stepRef({ number: 1084, outline: '1073.4' })).toBe('#1073.4');
    expect(stepRef({ number: 1084 })).toBe('#1084');
    expect(refFor(1081, outlines)).toBe('#1073.1');
    expect(refFor(9999, outlines)).toBe('#9999');
  });
});

describe('readableRefs', () => {
  it('turns stored numbers into outlines', () => {
    expect(readableRefs('Waits on #1084 and #1081; see #1084.', outlines)).toBe(
      'Waits on #1073.4 and #1073.1; see #1073.4.',
    );
  });

  it('leaves numbers that are not steps, longer numbers, outlines and pull requests alone', () => {
    expect(readableRefs('#10845 #1073.4 PR #1084 issue #1084 #42', outlines)).toBe(
      '#10845 #1073.4 PR #1084 issue #1084 #42',
    );
  });
});

describe('numberFromRef', () => {
  it('reads an outline or a number, with or without the hash', () => {
    expect(numberFromRef('1073.4', outlines)).toBe(1084);
    expect(numberFromRef('#1073.4.1', outlines)).toBe(1090);
    expect(numberFromRef('#1084', outlines)).toBe(1084);
    expect(numberFromRef('1073.9', outlines)).toBeNull();
    expect(numberFromRef('shelf', outlines)).toBeNull();
  });
});
