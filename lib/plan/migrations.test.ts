import { describe, expect, it } from 'vitest';
import {
  applyOrder,
  cannotRehearse,
  liveMigrationName,
  LOOSE_NAMES_THROUGH,
  rehearsalScript,
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

describe('liveMigrationName', () => {
  it('names a file the way migrationApplied reads it back', () => {
    const cases: Array<[string, string]> = [
      ['migrations-learn/0154_merge_ideas.sql', 'learn_0154_merge_ideas'],
      ['migrations/0251_post_preferences.sql', '0251_post_preferences'],
      ['migrations-job-search/0055_application_all_questions_added.sql', 'job_search_0055_application_all_questions_added'],
    ];
    for (const [path, name] of cases) {
      expect(liveMigrationName(path)).toBe(name);
      const [dir, file] = path.split('/');
      expect(migrationApplied({ dir, name: file }, new Set([name]))).toBe(true);
    }
  });
});

describe('applyOrder', () => {
  it('puts the core folder first and keeps file order within a folder', () => {
    expect(
      applyOrder([
        'migrations-learn/0155_b.sql',
        'migrations/0252_a.sql',
        'migrations-goals/0079_c.sql',
        'migrations-learn/0154_a.sql',
      ]),
    ).toEqual([
      'migrations/0252_a.sql',
      'migrations-goals/0079_c.sql',
      'migrations-learn/0154_a.sql',
      'migrations-learn/0155_b.sql',
    ]);
  });
});

describe('migrationApplied past the loose line', () => {
  const next = (dir: string, stem: string) => ({
    dir,
    name: `${String(LOOSE_NAMES_THROUGH[dir] + 1).padStart(4, '0')}_${stem}.sql`,
  });

  it('is not fooled by the same name in another folder', () => {
    const file = next('migrations-vault', 'merge_ideas');
    expect(migrationApplied(file, new Set(['learn_0154_merge_ideas']))).toBe(false);
  });

  it('takes the name the workflow writes, or the core folder name without its number', () => {
    const vault = next('migrations-vault', 'merge_ideas');
    expect(migrationApplied(vault, new Set([liveMigrationName(`${vault.dir}/${vault.name}`)]))).toBe(true);
    expect(migrationApplied(vault, new Set(['vault_merge_ideas']))).toBe(true);
    const core = next('migrations', 'post_preferences_two');
    expect(migrationApplied(core, new Set(['post_preferences_two']))).toBe(true);
    expect(migrationApplied(core, new Set(['learn_post_preferences_two']))).toBe(false);
  });

  it('keeps the loose rule for files already on main', () => {
    // migrations-job-search/0044 went in as a bare name with no folder.
    expect(
      migrationApplied({ dir: 'migrations-job-search', name: '0044_message_role_hint.sql' }, new Set(['message_role_hint'])),
    ).toBe(true);
  });
});

describe('cannotRehearse', () => {
  it('lets a function with its own begin and end through', () => {
    const sql = `create function f() returns void language plpgsql as $$\nbegin\n  delete from t;\nend;\n$$;\nupdate t set a = 1;`;
    expect(cannotRehearse(sql)).toBeNull();
  });

  it('stops a file that would end the transaction or cannot run in one', () => {
    expect(cannotRehearse('begin;\ncreate table t (id int);\ncommit;')).toMatch(/begin/);
    expect(cannotRehearse('create index concurrently i on t (a);')).toMatch(/concurrently/);
    expect(cannotRehearse('-- commit in a comment\nselect 1;')).toBeNull();
  });
});

describe('rehearsalScript', () => {
  it('runs every file inside one transaction and rolls it back', () => {
    const script = rehearsalScript([
      { path: 'migrations/0252_a.sql', sql: 'create table a (id int);' },
      { path: 'migrations/0253_b.sql', sql: 'insert into a values (1);' },
    ]);
    expect(script.startsWith('begin;')).toBe(true);
    expect(script.trimEnd().endsWith('rollback;')).toBe(true);
    expect(script.indexOf('create table a')).toBeLessThan(script.indexOf('insert into a'));
  });
});
