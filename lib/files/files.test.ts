import { describe, expect, it } from 'vitest';
import {
  authorLine,
  fileHref,
  fileVersionHref,
  fileViewHref,
  isUnread,
  originItemId,
  PAGE_VIEW_HEADERS,
  parseVersion,
  toDoc,
  toListing,
} from './files';

describe('files', () => {
  it('reads a row, treating any author but Dash as the person', () => {
    const doc = toDoc({
      id: 'f',
      title: 'Applications by role family',
      summary: null,
      made_by: 'claude',
      version: 2,
      created_at: '2026-09-26T10:00:00Z',
      updated_at: '2026-09-26T11:00:00Z',
      body: '# Hi',
      origin: 'goals.items:x',
      change_note: 'Added FP&A',
    });
    expect(doc).toMatchObject({ madeBy: 'claude', version: 2, changeNote: 'Added FP&A' });
    expect(toDoc({ ...rowOf(doc), made_by: 'someone' }).madeBy).toBe('you');
  });

  it('is unread while Dash wrote it and its newest version has not been opened (plan #1861)', () => {
    const row = {
      id: 'f',
      title: 'Firms hiring',
      summary: null,
      made_by: 'claude',
      version: 1,
      origin: null,
      created_at: '2026-10-12T09:00:00Z',
      updated_at: '2026-10-12T09:00:00Z',
    };
    expect(toListing(row).readAt).toBeNull();
    expect(isUnread(toListing(row))).toBe(true);
    expect(isUnread(toListing({ ...row, read_at: '2026-10-12T10:00:00Z' }))).toBe(false);
    expect(isUnread(toListing({ ...row, made_by: 'you' }))).toBe(false);
  });

  it('opens a file and one of its versions under Goals', () => {
    expect(fileHref('abc')).toBe('/goals/files/abc');
    expect(fileVersionHref('abc', 3)).toBe('/goals/files/abc?v=3');
  });

  it('takes only a whole positive version from the query', () => {
    expect(parseVersion('2')).toBe(2);
    expect(parseVersion(['4', '5'])).toBe(4);
    expect(parseVersion('0')).toBeNull();
    expect(parseVersion('2a')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it('finds the goals item a file came from, and nothing else', () => {
    const id = '6f1c1f5e-0000-4000-8000-000000000001';
    expect(originItemId(`goals.items:${id}`)).toBe(id);
    expect(originItemId('job_search.roles:1')).toBeNull();
    expect(originItemId(null)).toBeNull();
  });

  it('says who wrote it, and the version once there is more than one', () => {
    expect(authorLine({ madeBy: 'claude', version: 1 })).toBe('Written by Dash');
    expect(authorLine({ madeBy: 'you', version: 3 })).toBe('Written by you · version 3');
  });
});

function rowOf(doc: ReturnType<typeof toDoc>) {
  return {
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    made_by: doc.madeBy,
    version: doc.version,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    body: doc.body,
    origin: doc.origin,
    change_note: doc.changeNote,
  };
}

describe('a page a bot had made (plan #2997)', () => {
  const row = {
    id: 'f',
    title: 'Accounting practice drill',
    summary: null,
    made_by: 'claude',
    version: 1,
    origin: 'core.dash_handoffs:h',
    created_at: '2026-11-06T10:00:00Z',
    updated_at: '2026-11-06T10:00:00Z',
    body: '<!doctype html><p>Drill</p>',
    change_note: null,
  };

  it('reads its format, and any row without one as markdown', () => {
    expect(toDoc({ ...row, format: 'html' }).format).toBe('html');
    expect(toDoc(row).format).toBe('markdown');
    expect(toDoc({ ...row, format: 'pdf' }).format).toBe('markdown');
  });

  it('is served under Goals, a version by its number', () => {
    expect(fileViewHref('abc')).toBe('/goals/files/abc/view');
    expect(fileViewHref('abc', 2)).toBe('/goals/files/abc/view?v=2');
  });

  it('runs sandboxed, with every outside request refused and only the app able to frame it', () => {
    const csp = PAGE_VIEW_HEADERS['Content-Security-Policy'];
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(PAGE_VIEW_HEADERS['Content-Type']).toBe('text/html; charset=utf-8');
    expect(PAGE_VIEW_HEADERS['Cache-Control']).toBe('private, no-store');
  });
});
