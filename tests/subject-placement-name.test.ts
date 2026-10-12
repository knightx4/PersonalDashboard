import { describe, expect, it } from 'vitest';
import { nameKey } from '@/inngest/learn/subject-placement';

/** Subject placement matches the model's reply by name (plan #1806). */

describe('nameKey', () => {
  it('matches a name the model handed back with its spacing tidied', () => {
    expect(nameKey('A note on the economy, from the  view of a shop. Minnesota Implement ')).toBe(
      nameKey('A note on the economy, from the view of a shop. Minnesota Implement'),
    );
  });
});
