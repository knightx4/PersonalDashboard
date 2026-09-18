/**
 * The review queue may not ask for a column the view does not have.
 *
 * `public.inbox_messages` stopped being a table in 0029 and became a view over
 * `core.ingested_messages`, and the view was written without `created_at`. The
 * review queue's email read still asked for it. PostgREST refuses a request
 * over one unknown column, so the read returned nothing at all -- and because
 * the loader dropped the error, the page drew "Nothing needs review" while the
 * nav badge, which counts with its own narrower query, said 46.
 *
 * That mismatch is the only thing that made it visible, and it took a bug
 * report. This is the cheap version: the columns the loader names, checked
 * against the columns the view exposes, without a database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

/** The column list of the loader's `inbox_messages` select. */
function requestedColumns(): string[] {
  const source = readFileSync(join(root, 'lib/review/load.ts'), 'utf8');
  const from = source.indexOf(".from('inbox_messages')");
  expect(from).toBeGreaterThan(-1);

  // The first backtick-quoted select after it, which is the column list.
  const select = source.slice(from).match(/\.select\(\s*`([^`]+)`/);
  expect(select).not.toBeNull();

  return select![1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The columns `public.inbox_messages` actually exposes. */
function viewColumns(): string[] {
  const source = readFileSync(
    join(root, 'supabase/migrations/0029_unify_ingestion.sql'),
    'utf8',
  );
  const start = source.indexOf('create view public.inbox_messages');
  expect(start).toBeGreaterThan(-1);

  const body = source.slice(start, source.indexOf('from core.ingested_messages', start));
  const columns: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed.startsWith('create view') || trimmed === 'select') {
      continue;
    }
    // `m.id,` / `ea.user_id,` / `v.error` — an aliased column, one per line.
    const match = trimmed.match(/^(?:[a-z]+\.)?([a-z_]+),?$/);
    if (match) columns.push(match[1]);
  }
  return columns;
}

describe('the review queue against the inbox_messages view', () => {
  // If this stops finding the shapes it parses, it must fail rather than pass
  // on an empty list and go on guarding nothing.
  it('reads both column lists', () => {
    expect(requestedColumns().length).toBeGreaterThan(5);
    expect(viewColumns()).toContain('received_at');
    expect(viewColumns()).toContain('parse_status');
  });

  it('asks only for columns the view has', () => {
    const exposed = new Set(viewColumns());
    const missing = requestedColumns().filter((column) => !exposed.has(column));
    expect(missing).toEqual([]);
  });

  // The column that caused it, named, so the regression is unmistakable.
  it('does not ask for created_at, which the view dropped', () => {
    expect(requestedColumns()).not.toContain('created_at');
    expect(viewColumns()).not.toContain('created_at');
  });
});
