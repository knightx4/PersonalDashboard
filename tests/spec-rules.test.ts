/**
 * Every rule in a spec names a check that exists.
 *
 * A rule is held by a test file, by a counter in scripts/spec-counts.ts, or by
 * the weekly audit (docs/SPEC-LAYER-SPEC.md, Part 1). A rule naming a test that
 * was renamed away, or a counter nobody registered, reads as enforced and is
 * not, so this fails on either.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPECS } from '@/lib/specs/registry';
import { parseRules, ruleProblems, type RuleContext } from '@/lib/specs/rules';
import { SPEC_COUNTERS } from '@/scripts/spec-counts';

const ROOT = join(__dirname, '..');

const repo: RuleContext = {
  fileExists: (path) => existsSync(join(ROOT, path)),
  counters: new Map(SPEC_COUNTERS.map((c) => [c.name, { target: c.target }])),
};

describe('parseRules', () => {
  it('reads each rule with its check', () => {
    const parsed = parseRules(
      [
        '# A spec',
        '',
        '## Rules',
        '',
        '**R1.** Every comment thread is stored in `core.conversations`.',
        'Checked by: count `thread-tables`, baseline 6, target 1.',
        '',
        '**R2.** Every write Dash makes has a',
        '`core.dash_actions` row.',
        'Checked by: test `tests/dash-actions-recorded.test.ts`.',
        '',
        '**R3.** A Dash reply says what it could not do.',
        'Checked by: audit.',
        '',
        '**R4.** Model ids live in one file.',
        'Checked by: count `model-id-files`, baseline 3.',
        '',
        '## Next',
        '**R9.** Not a rule, it is outside the section.',
      ].join('\n'),
    );
    expect(parsed.hasSection).toBe(true);
    expect(parsed.rules.map((r) => [r.number, r.sentence, r.check])).toEqual([
      [
        1,
        'Every comment thread is stored in `core.conversations`.',
        { kind: 'count', counter: 'thread-tables', baseline: 6, target: 1 },
      ],
      [
        2,
        'Every write Dash makes has a `core.dash_actions` row.',
        { kind: 'test', path: 'tests/dash-actions-recorded.test.ts' },
      ],
      [3, 'A Dash reply says what it could not do.', { kind: 'audit' }],
      [4, 'Model ids live in one file.', { kind: 'count', counter: 'model-id-files', baseline: 3 }],
    ]);
  });

  it('skips a Rules heading and rules inside a code fence', () => {
    const parsed = parseRules(
      [
        '## Part 1',
        '```markdown',
        '## Rules',
        '**R1.** Example.',
        'Checked by: audit.',
        '```',
      ].join('\n'),
    );
    expect(parsed).toEqual({ hasSection: false, rules: [] });
  });
});

describe('ruleProblems', () => {
  const ctx: RuleContext = {
    fileExists: (path) => path === 'tests/real.test.ts',
    counters: new Map([['thread-tables', { target: 1 }]]),
  };
  const problems = (body: string) => ruleProblems(parseRules(`## Rules\n\n${body}`), ctx);

  it('passes rules whose checks exist', () => {
    expect(
      problems(
        [
          '**R1.** One.',
          'Checked by: count `thread-tables`, baseline 6, target 1.',
          '**R2.** Two.',
          'Checked by: test `tests/real.test.ts`.',
          '**R3.** Three.',
          'Checked by: audit.',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('fails a rule naming a missing test', () => {
    expect(problems('**R1.** One.\nChecked by: test `tests/gone.test.ts`.')).toEqual([
      'R1 names the test tests/gone.test.ts, which does not exist.',
    ]);
  });

  it('fails a rule naming a file vitest does not run', () => {
    expect(problems('**R1.** One.\nChecked by: test `scripts/check-ui.ts`.')[0]).toMatch(
      /not a \.test\.ts/,
    );
  });

  it('fails a rule naming an unknown counter', () => {
    expect(
      problems('**R1.** One.\nChecked by: count `nobody-wrote-me`, baseline 2, target 0.'),
    ).toEqual([
      'R1 names the counter nobody-wrote-me, which scripts/spec-counts.ts does not define.',
    ]);
  });

  it("fails a rule whose target is not the counter's", () => {
    expect(
      problems('**R1.** One.\nChecked by: count `thread-tables`, baseline 6, target 2.'),
    ).toEqual(["R1 gives thread-tables a target of 2, and the counter's is 1."]);
  });

  it('fails a rule with no check, a check of no kind, or a repeated number', () => {
    expect(
      problems(
        [
          '**R1.** One.',
          '**R2.** Two.',
          'Checked by: a careful reader.',
          '**R2.** Again.',
          'Checked by: audit.',
        ].join('\n'),
      ),
    ).toEqual([
      'R1 has no "Checked by:" line.',
      'R2 has a check that is not a count, a test or the audit: "Checked by: a careful reader.".',
      'R2 is numbered twice.',
    ]);
  });
});

describe('the specs on main', () => {
  for (const spec of SPECS) {
    const path = join(ROOT, 'docs', spec.file);
    it(`${spec.file}: every rule names a real check`, () => {
      expect(existsSync(path), `${spec.file} is in lib/specs/registry.ts but not in docs/`).toBe(
        true,
      );
      expect(ruleProblems(parseRules(readFileSync(path, 'utf8')), repo)).toEqual([]);
    });
  }
});
