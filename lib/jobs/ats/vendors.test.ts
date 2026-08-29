import { describe, expect, it } from 'vitest';
import * as smartrecruiters from './smartrecruiters';
import * as workable from './workable';
import * as recruitee from './recruitee';
import * as breezy from './breezy';
import * as bamboohr from './bamboohr';
import * as rippling from './rippling';

/**
 * These cover the mapping, not the endpoints.
 *
 * Every vendor here publishes an undocumented-but-public board, and the field
 * names below are the assumption this code rests on. A test cannot tell us the
 * assumption is right — only a live board can — but it can tell us the mapping
 * is self-consistent, that a missing section does not produce a half-populated
 * posting, and that "fetched successfully, description empty" fails loudly
 * instead of writing an empty JD.
 */

describe('smartrecruiters', () => {
  const payload = {
    id: '743999123456789',
    name: 'Staff Engineer',
    postingUrl: 'https://jobs.smartrecruiters.com/Ramp/743999123456789',
    location: { city: 'New York', region: 'NY', country: 'us' },
    jobAd: {
      sections: {
        companyDescription: { title: 'About us', text: '<p>We build things.</p>' },
        jobDescription: { title: 'The role', text: '<p>You will build things.</p>' },
        qualifications: { title: 'Requirements', text: '<ul><li>Five years</li></ul>' },
      },
    },
  };

  it('joins the ad sections in reading order, headings kept', () => {
    const posting = smartrecruiters.toPosting(payload, 'Ramp', '743999123456789');

    expect(posting.title).toBe('Staff Engineer');
    expect(posting.text).toContain('About us');
    expect(posting.text).toContain('We build things.');
    // Requirements is the input to requirement mapping, so losing it is worse
    // than losing the fetch.
    expect(posting.text).toContain('Five years');
    expect(posting.text.indexOf('About us')).toBeLessThan(posting.text.indexOf('The role'));
  });

  it('builds a location from the parts', () => {
    expect(smartrecruiters.toPosting(payload, 'Ramp', '1').location).toBe('New York, NY, us');
  });

  it('says so when the posting is remote', () => {
    const remote = { ...payload, location: { city: 'Anywhere', remote: true } };
    expect(smartrecruiters.toPosting(remote, 'Ramp', '1').location).toBe('Remote — Anywhere');
  });

  it('throws rather than returning a nameless posting', () => {
    expect(() => smartrecruiters.toPosting({}, 'Ramp', '1')).toThrow(/no posting/i);
  });
});

describe('workable', () => {
  const payload = {
    jobs: [
      { shortcode: 'ZZZZ', title: 'Other role', description: '<p>No.</p>' },
      {
        shortcode: 'A1B2C3D4E5',
        title: 'Backend Engineer',
        description: '<p>Build the platform.</p>',
        requirements: '<ul><li>Go</li></ul>',
        benefits: '<p>Pension.</p>',
        url: 'https://apply.workable.com/monzo/j/A1B2C3D4E5/',
        location: { city: 'London', country: 'United Kingdom', workplace_type: 'hybrid' },
      },
    ],
  };

  it('finds the posting by shortcode rather than taking the first', () => {
    const posting = workable.toPosting(payload, 'monzo', 'A1B2C3D4E5');
    expect(posting.title).toBe('Backend Engineer');
    expect(posting.atsJobId).toBe('A1B2C3D4E5');
  });

  it('matches a shortcode case-insensitively', () => {
    expect(workable.toPosting(payload, 'monzo', 'a1b2c3d4e5').title).toBe('Backend Engineer');
  });

  it('concatenates description, requirements and benefits', () => {
    const posting = workable.toPosting(payload, 'monzo', 'A1B2C3D4E5');
    expect(posting.text).toContain('Build the platform.');
    expect(posting.text).toContain('Go');
    expect(posting.text).toContain('Pension.');
  });

  it('marks the workplace type on the location', () => {
    expect(workable.toPosting(payload, 'monzo', 'A1B2C3D4E5').location).toBe(
      'hybrid — London, United Kingdom',
    );
  });

  it('throws when the shortcode is not on the board', () => {
    // A closed posting is the normal cause, and it must reach the paste box.
    expect(() => workable.toPosting(payload, 'monzo', 'GONE')).toThrow(/no matching posting/i);
  });
});

describe('recruitee', () => {
  const payload = {
    offers: [
      {
        id: 981234,
        slug: 'staff-engineer-platform',
        title: 'Staff Engineer, Platform',
        description: '<p>Own the platform.</p>',
        requirements: '<ul><li>Kubernetes</li></ul>',
        location: 'Amsterdam',
        careers_url: 'https://monzo.recruitee.com/o/staff-engineer-platform',
      },
    ],
  };

  it('maps an offer to a posting', () => {
    const posting = recruitee.toPosting(payload, 'monzo', 'staff-engineer-platform');
    expect(posting.title).toBe('Staff Engineer, Platform');
    expect(posting.text).toContain('Own the platform.');
    expect(posting.text).toContain('Kubernetes');
    expect(posting.atsJobId).toBe('981234');
  });

  it('still finds the offer when the URL slug carries a trailing id', () => {
    expect(recruitee.toPosting(payload, 'monzo', 'staff-engineer-platform-981234').title).toBe(
      'Staff Engineer, Platform',
    );
  });

  it('throws when nothing matches', () => {
    expect(() => recruitee.toPosting({ offers: [] }, 'monzo', 'x')).toThrow(/no matching/i);
  });
});

describe('breezy', () => {
  const positions = [
    {
      id: 'a1b2c3d4e5f6',
      name: 'Senior Engineer',
      description: '<p>Ship features.</p>',
      url: 'https://acme.breezy.hr/p/a1b2c3d4e5f6',
      location: { city: 'Berlin', country: { name: 'Germany' }, is_remote: true },
    },
  ];

  it('reads a board served as a bare array', () => {
    const posting = breezy.toPosting(positions, 'acme', 'a1b2c3d4e5f6');
    expect(posting.title).toBe('Senior Engineer');
    expect(posting.text).toBe('Ship features.');
    expect(posting.location).toBe('Remote — Berlin, Germany');
  });

  it('reads a board served under a positions key', () => {
    expect(breezy.toPosting({ positions }, 'acme', 'a1b2c3d4e5f6').title).toBe('Senior Engineer');
  });
});

describe('bamboohr', () => {
  it('unwraps the result envelope', () => {
    const posting = bamboohr.toPosting(
      {
        result: {
          id: 1234,
          jobOpeningName: 'Product Designer',
          description: '<p>Design the product.</p>',
          atsLocation: { city: 'Austin', state: 'TX' },
        },
      },
      'acme',
      '1234',
    );

    expect(posting.title).toBe('Product Designer');
    expect(posting.text).toBe('Design the product.');
    expect(posting.location).toBe('Austin, TX');
    expect(posting.atsJobId).toBe('1234');
  });

  it('accepts a detail served without the envelope', () => {
    expect(
      bamboohr.toPosting({ jobOpeningName: 'Product Designer' }, 'acme', '1234').title,
    ).toBe('Product Designer');
  });
});

describe('rippling', () => {
  const jobs = [
    {
      uuid: '9f2c1a44-11ce-4a52-9b03-6b0c2e1f7c21',
      name: 'Security Engineer',
      descriptionHtml: '<p>Keep it safe.</p>',
      workLocation: { label: 'San Francisco, CA' },
      workplaceType: 'REMOTE',
    },
  ];

  it('finds the posting by uuid', () => {
    const posting = rippling.toPosting(jobs, 'acme', '9f2c1a44-11ce-4a52-9b03-6b0c2e1f7c21');
    expect(posting.title).toBe('Security Engineer');
    expect(posting.text).toBe('Keep it safe.');
    expect(posting.location).toBe('Remote — San Francisco, CA');
  });

  it('reads a board served under an items key', () => {
    expect(rippling.toPosting({ items: jobs }, 'acme', null).title).toBe('Security Engineer');
  });
});
