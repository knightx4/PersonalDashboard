import { describe, expect, it } from 'vitest';
import { IDEA_DETAIL_MIN, ideaDetailShortfall } from './body';

const detail = (length: number) => 'x'.repeat(length);

describe('ideaDetailShortfall', () => {
  it('refuses a bare title', () => {
    expect(ideaDetailShortfall('Show what LinkedIn infers about you')).toMatch(/has only a title/);
  });

  it('refuses a title with lines under it but no blank line', () => {
    expect(ideaDetailShortfall(`A title\n${detail(IDEA_DETAIL_MIN)}`)).toMatch(/has only a title/);
  });

  it('refuses a paragraph too short to say what, where from and why', () => {
    expect(ideaDetailShortfall('A title\n\nIt would help.')).toMatch(/has 14 characters under its title/);
  });

  it('files a title and a paragraph long enough', () => {
    expect(ideaDetailShortfall(`A title\n\n${detail(IDEA_DETAIL_MIN)}`)).toBeNull();
  });

  it('counts every paragraph under the title', () => {
    const half = detail(IDEA_DETAIL_MIN / 2);
    expect(ideaDetailShortfall(`A title\r\n\r\n${half}\r\n\r\n${half}`)).toBeNull();
  });
});
