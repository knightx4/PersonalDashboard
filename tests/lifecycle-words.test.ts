import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIFECYCLES,
  LIFECYCLE_GLYPH,
  LIFECYCLE_SOURCES,
  LIFECYCLE_VERB,
  LIFECYCLE_WORD,
  NOT_A_CLOSING_STATUS,
  applicationLifecycle,
  closedToast,
  feedCardLifecycle,
  goalItemLifecycle,
  lifecycleOf,
  type LifecycleSource,
} from '@/lib/core/lifecycle';
import { STATUS_GLYPHS } from '@/lib/status-glyphs';

/**
 * Every status word in the migrations' checks and enums has a place among the
 * four closing words (plan #1957.1). A status added to a schema without a line
 * in lib/core/lifecycle.ts fails here, and so does a line whose words no
 * longer match the schema.
 */

const SUPABASE = join(process.cwd(), 'supabase');

type Found = { dir: string; kind: 'enum' | 'check'; name: string; words: string[] };

function migrationDirs(): string[] {
  return readdirSync(SUPABASE)
    .filter((entry) => entry === 'migrations' || entry.startsWith('migrations-'))
    .sort();
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function wordsIn(list: string): string[] {
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Reads the status vocabularies as the migrations leave them: an enum is its
 * create plus every `add value`, and a check constraint is the last one added
 * under its name, gone if the last thing done to it was to drop it.
 */
function vocabularies(): Found[] {
  const found = new Map<string, Found>();
  for (const dir of migrationDirs()) {
    for (const file of readdirSync(join(SUPABASE, dir)).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = stripComments(readFileSync(join(SUPABASE, dir, file), 'utf8'));
      const events: { at: number; run: () => void }[] = [];

      for (const m of sql.matchAll(/create\s+type\s+(?:\w+\.)?(\w+_(?:status|state))\s+as\s+enum\s*\(([^)]*)\)/gi)) {
        events.push({
          at: m.index ?? 0,
          run: () => found.set(`${dir}:${m[1]}`, { dir, kind: 'enum', name: m[1], words: wordsIn(m[2]) }),
        });
      }
      for (const m of sql.matchAll(/alter\s+type\s+(?:\w+\.)?(\w+_(?:status|state))\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi)) {
        events.push({
          at: m.index ?? 0,
          run: () => {
            const known = found.get(`${dir}:${m[1]}`);
            if (known && !known.words.includes(m[2])) known.words.push(m[2]);
          },
        });
      }
      for (const m of sql.matchAll(
        /constraint\s+(\w+_(?:status_ck|status_check|state_ck))\s+check\s*\(\s*\(?\s*\w+\s+in\s*\(([^)]*)\)/gi,
      )) {
        events.push({
          at: m.index ?? 0,
          run: () => found.set(`${dir}:${m[1]}`, { dir, kind: 'check', name: m[1], words: wordsIn(m[2]) }),
        });
      }
      for (const m of sql.matchAll(/drop\s+constraint\s+(?:if\s+exists\s+)?(\w+_(?:status_ck|status_check|state_ck))/gi)) {
        events.push({ at: m.index ?? 0, run: () => void found.delete(`${dir}:${m[1]}`) });
      }
      events.sort((a, b) => a.at - b.at).forEach((event) => event.run());
    }
  }
  return [...found.values()];
}

describe('closing words', () => {
  const all = vocabularies();

  it('reads the vocabularies it is meant to', () => {
    const names = all.map((f) => f.name);
    expect(names).toContain('task_status');
    expect(names).toContain('items_status_ck');
    expect(names).toContain('plan_items_status_ck');
    expect(names).toContain('feed_cards_status_ck');
  });

  it.each(Object.entries(LIFECYCLE_SOURCES))('%s maps every word the schema has', (_id, source: LifecycleSource) => {
    const schema = all.find((f) => f.dir === source.dir && f.name === source.name && f.kind === source.kind);
    expect(schema, `${source.name} not found in ${source.dir}`).toBeDefined();
    expect(Object.keys(source.words).sort()).toEqual([...(schema?.words ?? [])].sort());
    for (const ending of Object.values(source.words)) {
      expect(ending === null || LIFECYCLES.includes(ending)).toBe(true);
    }
  });

  it('has a decision for every status vocabulary in the migrations', () => {
    const mapped = new Set<string>(Object.values(LIFECYCLE_SOURCES).map((s) => s.name));
    const unplaced = all.filter((f) => !mapped.has(f.name) && !(f.name in NOT_A_CLOSING_STATUS));
    expect(
      unplaced.map((f) => `${f.dir}: ${f.name} (${f.words.join(', ')})`),
      'add each to LIFECYCLE_SOURCES, or to NOT_A_CLOSING_STATUS with why it closes nothing',
    ).toEqual([]);
  });

  it('keeps no entry for a vocabulary that is gone', () => {
    const present = new Set(all.map((f) => f.name));
    const stale = Object.keys(NOT_A_CLOSING_STATUS).filter((name) => !present.has(name));
    expect(stale).toEqual([]);
  });

  it('gives each of the four a word, a verb and a glyph that exists', () => {
    expect(LIFECYCLES.map((l) => LIFECYCLE_WORD[l])).toEqual(['Done', 'Dropped', 'Later', 'Declined']);
    expect(LIFECYCLES.map((l) => LIFECYCLE_VERB[l])).toEqual(['Done', 'Drop', 'Later', 'Decline']);
    for (const lifecycle of LIFECYCLES) expect(STATUS_GLYPHS).toContain(LIFECYCLE_GLYPH[lifecycle]);
  });

  it('names the row a closing toast closed (plan #1957.8)', () => {
    expect(closedToast('dropped', 'Book the boiler service')).toBe('Dropped: Book the boiler service');
    expect(closedToast('done', '  Renew the\n passport ')).toBe('Done: Renew the passport');
    expect(closedToast('declined', '')).toBe('Declined');
    expect(closedToast('later', null)).toBe('Later');
  });

  it('uses all four somewhere', () => {
    const used = new Set(Object.values(LIFECYCLE_SOURCES).flatMap((s) => Object.values(s.words)));
    for (const lifecycle of LIFECYCLES) expect(used.has(lifecycle)).toBe(true);
  });

  it('answers per workspace', () => {
    expect(goalItemLifecycle('parked')).toBe('later');
    expect(feedCardLifecycle('dismissed')).toBe('declined');
    expect(applicationLifecycle('withdrawn')).toBe('dropped');
    expect(applicationLifecycle('offer')).toBeNull();
    expect(lifecycleOf('todo.tasks.status', 'done')).toBe('done');
    expect(lifecycleOf('todo.tasks.status', 'something new')).toBeNull();
  });
});
