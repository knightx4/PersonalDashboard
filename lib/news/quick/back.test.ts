import { describe, expect, it } from 'vitest';
import { BACK_PAGES, parseBack, pushBack } from './back';

const page = (n: number) => [{ issueId: `issue-${n}`, storyIndex: n }];

describe('the Previous page stack', () => {
  it('reads nothing, junk and a wrong shape as empty', () => {
    expect(parseBack(null)).toEqual([]);
    expect(parseBack('not json')).toEqual([]);
    expect(parseBack('{"a":1}')).toEqual([]);
    expect(parseBack('[[{"issueId":1,"storyIndex":0}]]')).toEqual([]);
  });

  it('reads back what it wrote', () => {
    const stack = pushBack(pushBack([], page(1)), page(2));
    expect(parseBack(JSON.stringify(stack))).toEqual([page(1), page(2)]);
  });

  it('keeps only the newest pages', () => {
    let stack = pushBack([], page(0));
    for (let n = 1; n <= BACK_PAGES + 2; n += 1) stack = pushBack(stack, page(n));
    expect(stack).toHaveLength(BACK_PAGES);
    expect(stack.at(-1)).toEqual(page(BACK_PAGES + 2));
  });

  it('does not push an empty page', () => {
    expect(pushBack([page(1)], [])).toEqual([page(1)]);
  });
});
