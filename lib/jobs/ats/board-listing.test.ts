import { describe, expect, it } from 'vitest';
import { hydrate } from './board';
import * as greenhouse from './greenhouse';
import * as lever from './lever';
import * as ashby from './ashby';
import * as smartrecruiters from './smartrecruiters';
import * as workable from './workable';
import * as recruitee from './recruitee';
import * as breezy from './breezy';
import * as bamboohr from './bamboohr';
import * as rippling from './rippling';

/**
 * The board listings, which are the same payloads the single-posting fetchers
 * already parse — read whole instead of filtered down to one.
 *
 * Two things matter here and nothing else does. A listing must carry a title
 * and an id, because those are what the matcher works with; and the two vendors
 * that publish titles without descriptions must say so by coming back with an
 * empty `text`, because that empty string is the signal `hydrate` waits for. A
 * listing that quietly claimed to have a description would write an empty JD
 * and mark the role done.
 */

describe('board listings', () => {
  it('greenhouse reads a board with its descriptions inline', () => {
    const postings = greenhouse.toPostings(
      {
        jobs: [
          { id: 1, title: 'Backend Engineer', content: '&lt;p&gt;Build things.&lt;/p&gt;' },
          { id: 2, title: 'Office Manager', content: '&lt;p&gt;Run the office.&lt;/p&gt;' },
          { id: 3 },
        ],
      },
      'acme',
    );

    expect(postings).toHaveLength(2);
    expect(postings[0].atsJobId).toBe('1');
    expect(postings[0].text).toBe('Build things.');
  });

  it('lever reads a board with its descriptions inline', () => {
    const postings = lever.toPostings(
      [
        { id: 'uuid-1', text: 'Backend Engineer', descriptionPlain: 'Build things.' },
        { id: 'uuid-2' },
      ],
      'acme',
    );

    expect(postings).toHaveLength(1);
    expect(postings[0].title).toBe('Backend Engineer');
  });

  it('ashby reads a board with its descriptions inline', () => {
    const postings = ashby.toPostings(
      { jobs: [{ id: 'uuid-1', title: 'Backend Engineer', descriptionPlain: 'Build things.' }] },
      'acme',
    );

    expect(postings[0].text).toBe('Build things.');
    expect(postings[0].boardToken).toBe('acme');
  });

  it('workable reads a board with its descriptions inline', () => {
    const postings = workable.toPostings(
      { jobs: [{ shortcode: 'ABC123', title: 'Backend Engineer', description: '<p>Build.</p>' }] },
      'acme',
    );

    expect(postings[0].atsJobId).toBe('ABC123');
    expect(postings[0].text).toContain('Build.');
  });

  it('recruitee reads a board with its descriptions inline', () => {
    const postings = recruitee.toPostings(
      { offers: [{ id: 42, title: 'Backend Engineer', description: '<p>Build.</p>' }] },
      'acme',
    );

    expect(postings[0].atsJobId).toBe('42');
  });

  it('breezy reads a board with its descriptions inline', () => {
    const postings = breezy.toPostings(
      [{ id: 'pos-1', name: 'Backend Engineer', description: '<p>Build.</p>' }],
      'acme',
    );

    expect(postings[0].title).toBe('Backend Engineer');
  });

  it('rippling reads a board with its descriptions inline', () => {
    const postings = rippling.toPostings(
      { items: [{ uuid: 'uuid-1', name: 'Backend Engineer', descriptionHtml: '<p>Build.</p>' }] },
      'acme',
    );

    expect(postings[0].atsJobId).toBe('uuid-1');
  });

  it('smartrecruiters returns an index with no description, which hydrate fills', () => {
    const postings = smartrecruiters.toPostings(
      { content: [{ id: '743999', name: 'Backend Engineer' }] },
      'Acme',
    );

    expect(postings[0].atsJobId).toBe('743999');
    // Empty on purpose: the job ad is on another endpoint. Anything but empty
    // here would be read as "fetched, no description" and end the lookup.
    expect(postings[0].text).toBe('');
  });

  it('bamboohr returns an index with no description, which hydrate fills', () => {
    const postings = bamboohr.toPostings(
      [
        { id: 55, jobOpeningName: 'Backend Engineer', location: { city: 'London' } },
        { jobOpeningName: 'No id, unmatchable' },
      ],
      'acme',
    );

    expect(postings).toHaveLength(1);
    expect(postings[0].atsJobId).toBe('55');
    expect(postings[0].text).toBe('');
  });
});

describe('hydrate', () => {
  it('does not call anything when the board already carried the description', async () => {
    // The property that keeps a forty-role company at one request. If this
    // ever needed the network to pass, the common case would be forty-one.
    const posting = {
      vendor: 'greenhouse',
      title: 'Backend Engineer',
      text: 'Build things.',
      url: null,
      location: 'London',
      atsJobId: '1',
      boardToken: 'acme',
      questions: [],
    };

    await expect(hydrate('greenhouse', 'acme', posting)).resolves.toBe(posting);
  });

  it('does not try to fetch a posting the board gave no id for', async () => {
    const posting = {
      vendor: 'greenhouse',
      title: 'Backend Engineer',
      text: '',
      url: null,
      location: null,
      atsJobId: null,
      boardToken: 'acme',
      questions: [],
    };

    await expect(hydrate('greenhouse', 'acme', posting)).resolves.toBe(posting);
  });
});
