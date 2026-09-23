import { describe, expect, it } from 'vitest';
import * as content from '@/app/dev/ui/content';
import { ALL_LAWS } from '@/app/dev/ui/laws';
import { LAW_CHECK, LIST_CHECK } from '@/app/dev/ui/audit';

/**
 * Every rule on /dev/ui says how it is checked. A list added to content.ts, or
 * a law added to laws.ts, fails here until it is given a tag in audit.ts, so
 * the audit never quietly stops covering part of the guide.
 */
describe('the audit tags', () => {
  const lists = Object.entries(content)
    .filter(([, value]) => Array.isArray(value))
    .map(([name]) => name);

  it('tag every rule list in content.ts', () => {
    expect(lists.filter((name) => !(name in LIST_CHECK))).toEqual([]);
  });

  it('tag nothing that is not a list in content.ts', () => {
    expect(Object.keys(LIST_CHECK).filter((name) => !lists.includes(name))).toEqual([]);
  });

  it('tag every law', () => {
    expect(ALL_LAWS.map((law) => law.n).filter((n) => !(n in LAW_CHECK))).toEqual([]);
  });
});
