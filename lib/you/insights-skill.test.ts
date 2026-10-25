import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSIGHT_KINDS, INSIGHTS_SKILL_PATH, insightsBrief } from './insights';

const skill = readFileSync(join(process.cwd(), INSIGHTS_SKILL_PATH), 'utf8');

/** The numbered lines under "## Checklist", without their numbers. */
function checklist(): string[] {
  const section = skill.split('\n## Checklist\n')[1]?.split('\n## ')[0] ?? '';
  return section
    .split('\n')
    .filter((line) => /^\d+\. /.test(line))
    .map((line) => line.replace(/^\d+\. /, ''));
}

describe('insightsBrief', () => {
  it('hands the session to the insights skill and names the run and the account', () => {
    expect(insightsBrief({ runId: 'r1', userId: 'u1', reason: 'monthly' })).toBe(
      'Follow .claude/skills/insights/SKILL.md\nInsight run r1\nuser_id u1\nmonthly run',
    );
    expect(insightsBrief({ runId: 'r1', userId: 'u1', reason: 'look_again' }).split('\n')[3]).toBe(
      'started by Look again',
    );
  });

  it('names a change on one line, cut to 300 characters', () => {
    const brief = insightsBrief({
      runId: 'r1',
      userId: 'u1',
      reason: 'change',
      change: 'Rejected\n  by Acme ',
    });
    expect(brief.split('\n')[3]).toBe('started by a change: Rejected by Acme');
    const long = insightsBrief({
      runId: 'r1',
      userId: 'u1',
      reason: 'change',
      change: 'x'.repeat(400),
    });
    expect(long.split('\n')).toHaveLength(4);
    expect(long.split('\n')[3]).toHaveLength('started by a change: '.length + 300);
    expect(insightsBrief({ runId: 'r1', userId: 'u1', reason: 'change' }).split('\n')[3]).toBe(
      'started by a change',
    );
  });
});

describe('the insights skill', () => {
  it('is named for the brief that fires it', () => {
    expect(skill.startsWith('---\nname: insights\n')).toBe(true);
    expect(skill).toContain('Follow .claude/skills/insights/SKILL.md');
  });

  it('lists every step of the method in its checklist, in order', () => {
    const steps = checklist();
    expect(steps).toHaveLength(7);
    const expected: Array<[string, string[]]> = [
      ['Read what came before', ['where they are now', 'answer', 'verdict', 'knew it', 'prediction', 'already knows']],
      [
        'Read the core in full',
        ['Me/', 'journal', 'daily notes', 'link to', 'Inbox', 'vault map', 'clipped and secret'],
      ],
      ['Read what they did', ['three subagents', 'owner-scoped selects', '10 to 20 findings']],
      [
        'Find candidates',
        [
          'concept they named',
          'records can test',
          'phrase that comes back',
          'pull against',
          'recurs without action',
          'unrelated interests',
          'precedes a low',
          'what is missing',
        ],
      ],
      ['Go down three layers, then one more', ['saw', 'deeper', 'further', 'outside search', 'self-description']],
      [
        'Filter hard',
        [
          'restates one note',
          'two sources',
          'span of time',
          're-queried',
          'other explanation',
          'surprise check',
          'hunches',
          'correct earlier cards',
          'relationships, health and family',
        ],
      ],
      [
        'Write three to five cards',
        ['layers', 'receipts', 'confidence', 'live', 'question', 'hidden predictions', 'two-sentence summary'],
      ],
    ];
    expected.forEach(([title, words], index) => {
      expect(steps[index]).toMatch(new RegExp(`^\\*\\*${title}`));
      for (const word of words) expect(steps[index]).toContain(word);
    });
  });

  it('has a section for each step of the checklist', () => {
    for (const heading of [
      '## 1. Read what came before',
      '## 2. Read the core in full',
      '## 3. Read what they did',
      '## 4. Find candidates',
      '## 5. Go down three layers',
      '## 6. Filter hard',
      '## 7. Write the cards and finish the run',
    ]) {
      expect(skill).toContain(heading);
    }
  });

  it('names every kind a card may take', () => {
    for (const { kind } of INSIGHT_KINDS) expect(skill).toContain(`\`${kind}\``);
  });

  it('keeps secret notes out and scopes every write to the owner', () => {
    expect(skill).toContain('Me/Passwords.md');
    for (const voice of ['private', 'audience', 'clipped', 'reference', 'secret'])
      expect(skill).toContain(`\`${voice}\``);
    expect(skill).toContain('Never read or quote a note tagged secret');
    const writes = skill.match(/^(update|insert into) [^\n]+(\n(?!```)[^\n]*)*/gm) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const statement of writes) expect(statement).toContain("'<user_id>'");
  });

  it('never repeats an insight already marked', () => {
    expect(skill).toContain('every status');
    expect(skill).toContain('Marked right or wrong');
    expect(skill).toContain('Marked not quite');
    expect(skill).toContain("status = 'superseded'");
  });
});
