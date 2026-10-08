import { describe, expect, it } from 'vitest';

import {
  RECHECK_DAYS,
  boardFromLink,
  boardsOnPage,
  careersLinks,
  dueForBoardCheck,
  findBoard,
  findStartupBoards,
  pageLinks,
  type BoardIo,
} from './boards';

/** A web of pages, and the boards that exist: every board named `acme` reads, whoever's it is. */
function web(pages: Record<string, string>, boards: string[] = []) {
  const fetched: string[] = [];
  const read: string[] = [];
  const io: BoardIo = {
    fetchPage: async (url) => {
      fetched.push(url);
      const key = url.replace(/\/$/, '');
      if (!(key in pages)) return { url, status: 404, body: 'Not found' };
      return { url, status: 200, body: pages[key] };
    },
    readBoard: async (vendor, token) => {
      read.push(`${vendor}:${token}`);
      if (!boards.includes(`${vendor}:${token}`)) throw new Error('404');
      return [];
    },
  };
  return { io, fetched, read };
}

describe('boardFromLink', () => {
  it('reads the board hosts of the three main vendors', () => {
    expect(boardFromLink('https://jobs.ashbyhq.com/acme-labs')).toEqual({ vendor: 'ashby', token: 'acme-labs' });
    expect(boardFromLink('https://jobs.ashbyhq.com/acme/1a2b3c4d-0000-1111-2222-333344445555')).toEqual({ vendor: 'ashby', token: 'acme' });
    expect(boardFromLink('https://boards.greenhouse.io/acme/jobs/123')).toEqual({ vendor: 'greenhouse', token: 'acme' });
    expect(boardFromLink('https://job-boards.greenhouse.io/acme')).toEqual({ vendor: 'greenhouse', token: 'acme' });
    expect(boardFromLink('https://boards.greenhouse.io/embed/job_board/js?for=acme')).toEqual({ vendor: 'greenhouse', token: 'acme' });
    expect(boardFromLink('https://boards-api.greenhouse.io/v1/boards/acme/jobs')).toEqual({ vendor: 'greenhouse', token: 'acme' });
    expect(boardFromLink('https://jobs.lever.co/acme')).toEqual({ vendor: 'lever', token: 'acme' });
    expect(boardFromLink('https://api.lever.co/v0/postings/acme?mode=json')).toEqual({ vendor: 'lever', token: 'acme' });
  });

  it('does not read the vendors own sites as boards', () => {
    expect(boardFromLink('https://www.greenhouse.io/careers')).toBeNull();
    expect(boardFromLink('https://www.lever.co/jobs')).toBeNull();
    expect(boardFromLink('https://www.ashbyhq.com/customers')).toBeNull();
    expect(boardFromLink('https://boards.greenhouse.io/embed/job_board')).toBeNull();
    expect(boardFromLink('https://acme.com/careers')).toBeNull();
    expect(boardFromLink('mailto:jobs@acme.com')).toBeNull();
  });
});

describe('reading a page', () => {
  it('finds links in attributes and in script JSON', () => {
    const html = `<a href="/careers">Careers</a>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme&amp;b=1"></script>
      <script>{"jobsUrl":"https:\\u002F\\u002Fjobs.ashbyhq.com\\u002Facme"}</script>`;
    const links = pageLinks(html, 'https://acme.com/');
    expect(links).toContain('https://acme.com/careers');
    expect(boardsOnPage(links)).toEqual([
      { vendor: 'greenhouse', token: 'acme' },
      { vendor: 'ashby', token: 'acme' },
    ]);
    expect(careersLinks(links, 'acme.com')).toEqual(['https://acme.com/careers']);
  });

  it('puts the board linked most often first', () => {
    const links = ['https://jobs.lever.co/partner', 'https://jobs.ashbyhq.com/acme/1', 'https://jobs.ashbyhq.com/acme/2'];
    expect(boardsOnPage(links)[0]).toEqual({ vendor: 'ashby', token: 'acme' });
  });
});

describe('findBoard', () => {
  it('stores the Ashby board the company site links to', async () => {
    const { io } = web({ 'https://acme.dev': '<a href="https://jobs.ashbyhq.com/acme">Jobs</a>' }, ['ashby:acme']);
    const out = await findBoard({ website: 'https://acme.dev', postingUrl: null }, io);
    expect(out.board).toEqual({ vendor: 'ashby', token: 'acme', from: 'https://acme.dev/' });
  });

  it('stores nothing when only the name matches someone else’s board', async () => {
    // Greenhouse, Lever and Ashby all answer for `acme`, but the site never links to them.
    const { io, read } = web(
      { 'https://acme.dev': '<a href="/about">About</a><a href="https://twitter.com/acme">x</a>' },
      ['greenhouse:acme', 'lever:acme', 'ashby:acme'],
    );
    const out = await findBoard({ website: 'acme.dev', postingUrl: null }, io);
    expect(out.board).toBeNull();
    expect(read).toEqual([]);
  });

  it('follows the home page to the careers page', async () => {
    const { io, fetched } = web(
      {
        'https://acme.dev': '<a href="/company/careers">Careers</a>',
        'https://acme.dev/company/careers': '<iframe src="https://job-boards.greenhouse.io/embed/job_board?for=acmehq"></iframe>',
      },
      ['greenhouse:acmehq'],
    );
    const out = await findBoard({ website: 'https://acme.dev', postingUrl: null }, io);
    expect(out.board).toMatchObject({ vendor: 'greenhouse', token: 'acmehq' });
    expect(fetched).toEqual(['https://acme.dev/', 'https://acme.dev/company/careers']);
  });

  it('tries /careers and /jobs when the home page links to neither', async () => {
    const { io } = web(
      { 'https://acme.dev': '<p>hello</p>', 'https://acme.dev/jobs': '<a href="https://jobs.lever.co/acme">Open roles</a>' },
      ['lever:acme'],
    );
    const out = await findBoard({ website: 'https://acme.dev', postingUrl: null }, io);
    expect(out.board).toMatchObject({ vendor: 'lever', token: 'acme' });
  });

  it('does not follow a careers link to another site', async () => {
    const { io, fetched } = web({ 'https://acme.dev': '<a href="https://other.com/careers">Careers</a>' });
    await findBoard({ website: 'https://acme.dev', postingUrl: null }, io);
    expect(fetched).not.toContain('https://other.com/careers');
  });

  it('skips a linked board that no longer reads', async () => {
    const { io } = web(
      { 'https://acme.dev': '<a href="https://jobs.lever.co/acme-old">x</a><a href="https://jobs.ashbyhq.com/acme">y</a>' },
      ['ashby:acme'],
    );
    const out = await findBoard({ website: 'https://acme.dev', postingUrl: null }, io);
    expect(out.board).toMatchObject({ vendor: 'ashby', token: 'acme' });
  });

  it('takes the board from the company’s own Hacker News apply link', async () => {
    const { io, fetched } = web({}, ['ashby:widgets']);
    const out = await findBoard({ website: null, postingUrl: 'https://jobs.ashbyhq.com/widgets/abcd1234-0000' }, io);
    expect(out.board).toMatchObject({ vendor: 'ashby', token: 'widgets' });
    expect(fetched).toEqual([]);
  });

  it('reads a post’s careers page as the site when there is no website', async () => {
    const { io } = web(
      { 'https://widgets.io/careers': '<a href="https://boards.greenhouse.io/widgets">Roles</a>' },
      ['greenhouse:widgets'],
    );
    const out = await findBoard({ website: null, postingUrl: 'https://widgets.io/careers' }, io);
    expect(out.board).toMatchObject({ vendor: 'greenhouse', token: 'widgets' });
  });

  it('does not read a job site link as the company’s site', async () => {
    const { io, fetched } = web({});
    const out = await findBoard({ website: null, postingUrl: 'https://www.ycombinator.com/companies/widgets/jobs' }, io);
    expect(out.board).toBeNull();
    expect(fetched).toEqual([]);
  });

  it('stops after four pages', async () => {
    const { io, fetched } = web({
      'https://acme.dev': '<a href="/careers/a">a</a><a href="/careers/b">b</a>',
      'https://acme.dev/careers/a': '<a href="/jobs/c">c</a>',
    });
    await findBoard({ website: 'https://acme.dev', postingUrl: null }, io);
    expect(fetched.length).toBeLessThanOrEqual(4);
  });
});

describe('dueForBoardCheck', () => {
  const now = new Date('2026-10-08T00:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  it('looks again only after four weeks', () => {
    expect(dueForBoardCheck({ board_token: null, board_checked_at: null }, now)).toBe(true);
    expect(dueForBoardCheck({ board_token: null, board_checked_at: daysAgo(RECHECK_DAYS - 1) }, now)).toBe(false);
    expect(dueForBoardCheck({ board_token: null, board_checked_at: daysAgo(RECHECK_DAYS) }, now)).toBe(true);
    expect(dueForBoardCheck({ board_token: 'acme', board_checked_at: null }, now)).toBe(false);
  });
});

describe('findStartupBoards', () => {
  type Row = Record<string, unknown>;
  function fakeSupabase(rows: Row[]) {
    const filters: string[] = [];
    return {
      filters,
      client: {
        from() {
          let patch: Row | null = null;
          const where: Record<string, unknown> = {};
          const chain = {
            select: () => chain,
            eq: (column: string, value: unknown) => {
              where[column] = value;
              if (patch && 'id' in where && 'user_id' in where) {
                const row = rows.find((r) => r.id === where.id && r.user_id === where.user_id);
                if (row) Object.assign(row, patch);
                return Promise.resolve({ error: null });
              }
              return chain;
            },
            is: () => chain,
            or: (filter: string) => {
              filters.push(filter);
              return chain;
            },
            order: () => chain,
            limit: () => Promise.resolve({ data: rows.filter((r) => r.user_id === where.user_id).map((r) => ({ ...r })), error: null }),
            update: (value: Row) => {
              patch = value;
              return chain;
            },
          };
          return chain;
        },
      } as never,
    };
  }

  it('writes a found board with its check, and a miss with only the check', async () => {
    const now = new Date('2026-10-08T00:00:00Z');
    const rows: Row[] = [
      { id: 'a', user_id: 'u1', name: 'Acme', website: 'https://acme.dev', posting_url: null, board_token: null, board_vendor: null, board_checked_at: null },
      { id: 'b', user_id: 'u1', name: 'Other Acme', website: 'https://other.dev', posting_url: null, board_token: null, board_vendor: null, board_checked_at: null },
      { id: 'c', user_id: 'u1', name: 'Recent', website: 'https://recent.dev', posting_url: null, board_token: null, board_vendor: null, board_checked_at: '2026-10-01T00:00:00Z' },
    ];
    const { io, fetched } = web(
      { 'https://acme.dev': '<a href="https://jobs.ashbyhq.com/acme">Jobs</a>', 'https://other.dev': '<p>We make things.</p>' },
      ['ashby:acme', 'greenhouse:otheracme', 'ashby:otheracme'],
    );
    const fake = fakeSupabase(rows);
    const out = await findStartupBoards(fake.client, 'u1', { now, io, deadline: Date.now() + 600_000 });

    expect(out).toEqual({ checked: 2, found: 1, left: 0 });
    expect(rows[0]).toMatchObject({ board_vendor: 'ashby', board_token: 'acme', board_checked_at: now.toISOString() });
    expect(rows[1]).toMatchObject({ board_vendor: null, board_token: null, board_checked_at: now.toISOString() });
    expect(rows[2].board_checked_at).toBe('2026-10-01T00:00:00Z');
    expect(fetched.some((url) => url.startsWith('https://recent.dev'))).toBe(false);
    expect(fake.filters[0]).toBe('board_checked_at.is.null,board_checked_at.lt.2026-09-10T00:00:00.000Z');
  });

  it('starts nothing when the time has run out, and says how many are left', async () => {
    const rows: Row[] = [
      { id: 'a', user_id: 'u1', name: 'Acme', website: 'https://acme.dev', posting_url: null, board_token: null, board_checked_at: null },
    ];
    const { io, fetched } = web({});
    const out = await findStartupBoards(fakeSupabase(rows).client, 'u1', { io, deadline: Date.now() + 1_000 });
    expect(out).toEqual({ checked: 0, found: 0, left: 1 });
    expect(fetched).toEqual([]);
    expect(rows[0].board_checked_at).toBeNull();
  });
});
