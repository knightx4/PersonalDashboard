import { describe, expect, it } from 'vitest';
import { HOME_CRUMB, sectionPath, sectionSubject } from './section-path';

describe('a list page’s path (plan #1931.2)', () => {
  it('reads workspace › section', () => {
    expect(sectionPath('/jobs/companies', 'Companies')).toEqual([
      { label: 'Job search', href: '/jobs' },
      { label: 'Companies', href: '/jobs/companies' },
    ]);
  });

  it('names a section at the workspace’s own address once', () => {
    expect(sectionPath('/vault', 'Notes')).toEqual([{ label: 'Vault', href: '/vault' }]);
  });

  it('starts at Home outside every workspace, and runs on to a page below', () => {
    expect(sectionPath('/timeline', 'Timeline', { label: '2025 in review', href: '/timeline/year/2025' })).toEqual([
      HOME_CRUMB,
      { label: 'Timeline', href: '/timeline' },
      { label: '2025 in review', href: '/timeline/year/2025' },
    ]);
  });

  it('is a subject with no row', () => {
    expect(sectionSubject('/dev/plan', 'Plan').ref).toBeNull();
  });
});
