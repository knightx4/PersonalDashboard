import { describe, expect, it } from 'vitest';
import {
  migrationApplied,
  unappliedMigrations,
  unappliedSentence,
  VERIFIED_THROUGH,
} from '@/lib/plan/migrations';

/**
 * Names copied from the live history on 22 September 2026, one of each shape
 * a session has used when applying a migration.
 */
const LIVE = new Set([
  'learn_0026_catalogue_judgements',
  'plan_main_check_reason',
  'learn_concept_subjects',
  'map_sweep',
  'news_0004_issues_unsubscribe_sent_at',
]);

describe('migrationApplied', () => {
  it('matches every naming shape the live history uses', () => {
    const cases: Array<[string, string]> = [
      ['migrations-learn', '0026_catalogue_judgements.sql'],
      ['migrations', '0095_plan_main_check_reason.sql'],
      ['migrations-learn', '0020_concept_subjects.sql'],
      ['migrations-vault', '0004_map_sweep.sql'],
      ['migrations-news', '0004_issues_unsubscribe_sent_at.sql'],
    ];
    for (const [dir, name] of cases) expect(migrationApplied({ dir, name }, LIVE)).toBe(true);
  });

  it('does not take one name for another that merely starts the same', () => {
    expect(migrationApplied({ dir: 'migrations-vault', name: '0005_map.sql' }, LIVE)).toBe(false);
    expect(
      migrationApplied(
        { dir: 'migrations', name: '0097_sweep.sql' },
        new Set(['map_sweep_tick_cron']),
      ),
    ).toBe(false);
  });
});

describe('unappliedMigrations', () => {
  it('lists only files past the verified line that nothing records', () => {
    const line = VERIFIED_THROUGH.migrations;
    const pad = (n: number) => String(n).padStart(4, '0');
    const files = [
      { dir: 'migrations', name: `${pad(line)}_old_and_unnamed.sql` },
      { dir: 'migrations', name: `${pad(line + 1)}_plan_main_check_reason.sql` },
      { dir: 'migrations', name: `${pad(line + 2)}_new_and_missing.sql` },
      { dir: 'migrations', name: 'README.md' },
      { dir: 'migrations-brand-new', name: '0001_first.sql' },
    ];
    expect(unappliedMigrations(files, LIVE)).toEqual([
      'migrations-brand-new/0001_first.sql',
      `migrations/${pad(line + 2)}_new_and_missing.sql`,
    ]);
  });
});

describe('unappliedSentence', () => {
  it('says nothing when nothing is missing', () => {
    expect(unappliedSentence([])).toBeNull();
  });

  it('names up to three and counts the rest', () => {
    expect(unappliedSentence(['migrations/0096_a.sql'])).toBe(
      '1 migration is on main but not applied to the live database: migrations/0096_a.sql.',
    );
    const five = ['a', 'b', 'c', 'd', 'e'].map((x) => `migrations/${x}.sql`);
    expect(unappliedSentence(five)).toContain('migrations/c.sql and 2 more.');
    expect(unappliedSentence(five)).not.toContain('migrations/d.sql');
  });
});
