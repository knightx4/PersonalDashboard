import { describe, expect, it } from 'vitest';
import type { AgendaItem } from '@/lib/todo/agenda/sources';
import { withoutCovered } from './covered';

function item(over: Partial<AgendaItem>): AgendaItem {
  return {
    key: 'k',
    source: 'applications',
    ref: 'job_search.applications:a1',
    title: 'Reply to Monzo',
    day: null,
    at: null,
    link: null,
    action: null,
    detail: null,
    completable: false,
    ...over,
  };
}

describe('withoutCovered', () => {
  it('leaves out the application an email asking something stands for', () => {
    const application = item({});
    const email = item({
      key: 'job_waiting:e1',
      source: 'job_waiting',
      ref: 'job_search.application_events:e1',
      title: 'Asked for your availability next week',
      covers: ['job_search.applications:a1'],
    });
    const other = item({ key: 'k2', ref: 'job_search.applications:a2', title: 'Reply to Wise' });
    expect(withoutCovered([application, email, other])).toEqual([email, other]);
  });

  it('keeps everything when nothing covers anything', () => {
    const items = [item({}), item({ key: 'k2', ref: 'job_search.applications:a2' })];
    expect(withoutCovered(items)).toEqual(items);
  });

  it('keeps two items that cover each other', () => {
    const a = item({ ref: 'x:1', covers: ['x:2'] });
    const b = item({ ref: 'x:2', covers: ['x:1'] });
    expect(withoutCovered([a, b])).toEqual([a, b]);
  });
});
