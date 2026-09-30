import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/vault/auth/server', () => ({ createVaultClient: vi.fn() }));

import { rankHits } from '@/lib/search/rank';
import { courseHit } from './education';

/** Courses in the palette and Dash's search (plan #1309). */
describe('courseHit', () => {
  const econ = courseHit({
    id: 'c1',
    school: 'State University',
    code: 'ECON 101',
    title: 'Principles of Economics',
    term: 'Fall 2019',
    year: 2019,
  });

  it('names the course by code and title and links its row on the Education tab', () => {
    expect(econ).toMatchObject({
      module: 'vault',
      kind: 'course',
      title: 'ECON 101 Principles of Economics',
      subtitle: 'Course · State University · Fall 2019',
      href: '/vault/education#course-c1',
    });
  });

  it('is found by its term and school as well as its title', () => {
    const calc = courseHit({ id: 'c2', school: 'City College', code: null, title: 'Calculus I', term: null, year: 2018 });
    expect(calc.subtitle).toBe('Course · City College · 2018');
    expect(rankHits([econ, calc], 'fall 2019').map((h) => h.id)).toEqual(['c1']);
    expect(rankHits([econ, calc], 'city college').map((h) => h.id)).toEqual(['c2']);
    expect(rankHits([econ, calc], 'economics').map((h) => h.id)).toEqual(['c1']);
  });
});
