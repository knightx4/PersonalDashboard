import { describe, expect, it, vi } from 'vitest';
import { PAGES, pageFor } from '@/lib/sources/catalogue';
import { NO_LONGER_THERE, parseRef, refHref, refTitles, toRef, type ReadRows } from './refs';

const ID = '1fc661a1-c4da-4e07-8fb4-82b256db5611';
const OTHER = '04bd04f4-f6d4-4737-b3b5-492a99eda54e';

describe('parseRef', () => {
  it('splits schema.table:id', () => {
    expect(parseRef(`goals.items:${ID}`)).toEqual({ table: 'goals.items', schema: 'goals', name: 'items', id: ID });
  });

  it('keeps a colon inside the id', () => {
    expect(parseRef('public.orders:a:b')?.id).toBe('a:b');
  });

  it('refuses what is not a ref', () => {
    for (const bad of ['', 'goals.items', 'items:1', 'goals.items:', 'Goals.Items:1', 'a.b.c:1']) {
      expect(parseRef(bad), bad).toBeNull();
    }
  });

  it('reads the refs core.files.origin and observation evidence already hold', () => {
    expect(parseRef(`job_search.interviews:${ID}`)?.table).toBe('job_search.interviews');
    expect(toRef('todo.tasks', ID)).toBe(`todo.tasks:${ID}`);
  });
});

describe('the registry', () => {
  it('names each table once', () => {
    const tables = PAGES.map((p) => p.table);
    expect(tables.filter((t, i) => tables.indexOf(t) !== i)).toEqual([]);
  });

  it('covers tables Goals does not read as well as sources', () => {
    expect(pageFor('public.plan_items')).not.toBeNull();
    expect(pageFor('public.orders')).not.toBeNull();
    expect(pageFor('job_search.roles')).not.toBeNull();
    expect(pageFor('news.preferences')).toBeNull();
    expect(pageFor('public.merchants')).toBeNull();
  });
});

describe('refHref', () => {
  it('gives the page straight from the id where it can', () => {
    expect(refHref(`public.orders:${ID}`)).toBe(`/shopping/orders/${ID}`);
    expect(refHref(`job_search.roles:${ID}`)).toBe(`/jobs/roles/${ID}`);
    expect(refHref(`todo.tasks:${ID}`)).toBe(`/todo/all?status=all&focus=${ID}`);
  });

  it('goes through /open where the page needs another column', () => {
    expect(refHref(`public.plan_items:${ID}`)).toBe(`/open/${encodeURIComponent(`public.plan_items:${ID}`)}`);
    expect(refHref(`obsidian.notes:${ID}`)).toMatch(/^\/open\//);
  });

  it('is null for a table with no page or a malformed ref', () => {
    expect(refHref(`public.merchants:${ID}`)).toBeNull();
    expect(refHref('nothing')).toBeNull();
  });
});

describe('refTitles', () => {
  it('reads each table once and names each row with its page', async () => {
    const read = vi.fn<ReadRows>(async (table, _columns, ids) => {
      if (table === 'public.plan_items') return ids.map((id) => ({ id, title: 'Give rows a ref', number: 1449 }));
      if (table === 'goals.items') {
        return ids.map((id) =>
          id === ID
            ? { id, title: 'Run a marathon', level: 'goal', parent_id: null }
            : { id, title: 'Buy shoes', level: 'step', parent_id: ID },
        );
      }
      return [];
    });

    const refs = [`public.plan_items:${ID}`, `goals.items:${ID}`, `goals.items:${OTHER}`];
    const out = await refTitles(refs, read);

    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.find(([t]) => t === 'goals.items')?.[2]).toEqual([ID, OTHER]);
    expect(read.mock.calls.find(([t]) => t === 'public.plan_items')?.[1]).toEqual(['id', 'title', 'number']);
    expect(out.get(refs[0])).toMatchObject({
      missing: false,
      title: 'Give rows a ref',
      href: '/dev/plan?view=all&q=%231449#plan-1449',
    });
    expect(out.get(refs[1])).toMatchObject({ title: 'Run a marathon', href: `/goals/${ID}` });
    expect(out.get(refs[2])).toMatchObject({ title: 'Buy shoes', href: `/goals/${ID}/s/${OTHER}` });
  });

  it('answers a gone row, an unknown table and a non-ref as no longer there', async () => {
    const read: ReadRows = async () => [];
    const refs = [`public.orders:${ID}`, `public.merchants:${ID}`, 'not a ref'];
    const out = await refTitles(refs, read);
    for (const ref of refs) {
      expect(out.get(ref), ref).toMatchObject({ missing: true, title: NO_LONGER_THERE, href: null });
    }
    expect(out.get(refs[0])).toMatchObject({ table: 'public.orders', id: ID });
  });

  it('cuts a long title to one short line', async () => {
    const body = `${'word '.repeat(40)}\nsecond line`;
    const out = await refTitles([`public.ideas:${ID}`], async (_t, _c, ids) => ids.map((id) => ({ id, body })));
    const title = out.get(`public.ideas:${ID}`)!.title;
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('second');
  });

  it('reads nothing for an empty batch', async () => {
    const read = vi.fn<ReadRows>(async () => []);
    expect((await refTitles([], read)).size).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
});
