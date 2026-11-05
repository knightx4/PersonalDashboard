import { describe, expect, it } from 'vitest';
import {
  briefLessons,
  clip,
  criticLesson,
  gateLesson,
  knownLesson,
  lessonKey,
  lessonsBlock,
  rankLessons,
  type LessonRow,
} from './friction';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function lesson(over: Partial<LessonRow> & { id: string; key: string }): LessonRow {
  return {
    title: over.key,
    lesson: null,
    status: 'open',
    fix: null,
    fixed_at: null,
    regressed_at: null,
    ...over,
  };
}

describe('knownLesson', () => {
  it('files the stop lines seen on #2879 under the critic gate and the shooter', () => {
    expect(
      knownLesson(
        'Code is already on main (merge abae8ce79) but land closed no steps: the design critic has recorded no round for the chat-people surfaces',
      )?.key,
    ).toBe('close-refused-by-critic-gate');
    expect(
      knownLesson("ui-guard --compare failed in this session: all six shooters, branch and main, died with 'fetch failed'")
        ?.key,
    ).toBe('shooter-or-preview-build-failed');
  });

  it("files built's own refusal under the wrong-commit lesson", () => {
    expect(knownLesson('a33223a7f is "Draw group chats", which names #2879.1.3 and not #2879.1.1.')?.key).toBe(
      'built-records-another-steps-commit',
    );
  });

  it('knows the stop lines the first review found unfiled', () => {
    expect(knownLesson('Closing the feature row is refused by ui-guard: the critic has no recorded round on 80 You surfaces')?.key).toBe(
      'feature-row-close-checks-every-surface',
    );
    expect(knownLesson('close is refused: GITHUB_READ_TOKEN gets 404 reading the repo')?.key).toBe(
      'github-read-token-cannot-read-repo',
    );
    expect(knownLesson('add_repo tool unavailable in the routine session; interactive-islm not attached')?.key).toBe(
      'add-repo-searched-instead-of-called',
    );
    expect(knownLesson('All three steps were already built and closed by an earlier worker; nothing left to build.')?.key).toBe(
      'run-sent-with-nothing-to-build',
    );
  });

  it('leaves an unknown line for the review', () => {
    expect(knownLesson('The weather was bad')).toBeNull();
  });
});

describe('lesson keys', () => {
  it('makes a key from any text', () => {
    expect(lessonKey('Gate: Lint / react-hooks/exhaustive-deps!')).toBe('gate-lint-react-hooks-exhaustive-deps');
    expect(lessonKey('?')).toBe('x-unnamed');
  });

  it('files lint by rule, so one rule broken every week is one row', () => {
    const log = '/app/x.tsx\n  12:5  error  Unexpected any  @typescript-eslint/no-explicit-any\n';
    expect(gateLesson('Lint', log).key).toBe('gate-lint-typescript-eslint-no-explicit-any');
    expect(gateLesson('Build', '').key).toBe('gate-build');
    expect(gateLesson('Test', ' FAIL  |db| tests/rls.test.ts > cross-user reads').key).toBe('gate-test-rls');
  });

  it('files a critic fix by the law it breaks', () => {
    expect(criticLesson('done-when').key).toBe('critic-done-when');
  });

  it('clips to one line', () => {
    expect(clip('a\n\nb', 10)).toBe('a b');
    expect(clip('x'.repeat(20), 10)).toHaveLength(10);
  });
});

describe('rankLessons', () => {
  const gate = lesson({ id: 'g', key: 'close-refused-by-critic-gate', lesson: 'Run ui-guard --compare.' });
  const lint = lesson({ id: 'l', key: 'gate-lint-x', lesson: 'Do not use any.', status: 'taught' });
  const fixed = lesson({
    id: 'f',
    key: 'built-records-another-steps-commit',
    status: 'fixed',
    fix: 'chooseBuiltCommit',
    fixed_at: ago(3),
  });
  const ignored = lesson({ id: 'w', key: 'wont', status: 'wont_fix' });
  const friction = [
    { lesson_id: 'g', kind: 'guard', cost_minutes: 30, created_at: ago(1) },
    { lesson_id: 'g', kind: 'stop', cost_minutes: null, created_at: ago(2) },
    { lesson_id: 'l', kind: 'gate', cost_minutes: 5, created_at: ago(1) },
    { lesson_id: 'l', kind: 'gate', cost_minutes: 5, created_at: ago(20) },
    { lesson_id: 'f', kind: 'guard', cost_minutes: 1, created_at: ago(5) },
    { lesson_id: 'f', kind: 'guard', cost_minutes: 1, created_at: ago(1) },
    { lesson_id: 'w', kind: 'tool', cost_minutes: 300, created_at: ago(1) },
  ];

  it('puts a regression first, then orders by minutes lost, and leaves wont-fix out', () => {
    const ranked = rankLessons([gate, lint, fixed, ignored], friction, NOW);
    expect(ranked.map((l) => l.key)).toEqual(['built-records-another-steps-commit', 'close-refused-by-critic-gate', 'gate-lint-x']);
    expect(ranked[0].sinceFix).toBe(1);
    expect(ranked[1].minutes).toBe(45);
    expect(ranked[2].before).toBe(1);
  });

  it('shows builders the lessons with words, and a regression even without', () => {
    const lines = briefLessons(rankLessons([gate, lint, fixed], friction, NOW));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('REGRESSED');
    expect(lines[1]).toContain('hit 2× in 14 days');
    expect(lessonsBlock(lines)).toContain('npm run friction -- log');
    expect(lessonsBlock([])).toBe('');
  });

  it('does not show a fixed lesson that has stayed fixed', () => {
    const quiet = lesson({ ...fixed, id: 'q', lesson: 'Old advice.' });
    expect(briefLessons(rankLessons([quiet], [], NOW))).toEqual([]);
  });
});
