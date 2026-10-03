import { describe, expect, it } from 'vitest';
import {
  checkRuleRequest,
  notePage,
  noteRuleProblem,
  noteRuleSql,
  ruleEvidence,
  type RuleNote,
} from './note-rules';

const NOW = new Date('2026-10-03T12:00:00Z');

function note(id: string, page: string | null, over: Partial<RuleNote> = {}): RuleNote {
  return {
    id,
    kind: 'feature',
    status: 'open',
    page_path: page,
    created_at: '2026-09-20T10:00:00Z',
    spec_change_id: null,
    ...over,
  };
}

const DIFF = [
  '--- a/docs/CORE-AND-DASH-SPEC.md',
  '+++ b/docs/CORE-AND-DASH-SPEC.md',
  '@@ -1,1 +1,2 @@',
  ' ## Rules',
  '+**R9.** Every delete asks first.',
].join('\n');

describe('notePage', () => {
  it('reads the page without its query or trailing slash', () => {
    expect(notePage('/todo?view=week')).toBe('/todo');
    expect(notePage('/todo/')).toBe('/todo');
    expect(notePage('/')).toBe('/');
  });

  it('leaves out surface notes and notes with no page', () => {
    expect(notePage('/preview?s=todo-list')).toBeNull();
    expect(notePage(null)).toBeNull();
  });
});

describe('checkRuleRequest', () => {
  it('takes three notes on three pages as a rule', () => {
    const check = checkRuleRequest(
      [note('c', '/vault', { created_at: '2026-09-25T00:00:00Z' }), note('a', '/todo'), note('b', '/jobs?x=1')],
      NOW,
    );
    expect(check.ok).toBe(true);
    expect(check.notes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(check.pages).toEqual(['/todo', '/jobs', '/vault']);
  });

  it('leaves a single note to be fixed on its page', () => {
    const check = checkRuleRequest([note('a', '/todo')], NOW);
    expect(check.ok).toBe(false);
    expect(check.why).toContain('fixed on its page');
  });

  it('does not count three notes on the same page as three pages', () => {
    const check = checkRuleRequest([note('a', '/todo'), note('b', '/todo?x'), note('c', '/todo/')], NOW);
    expect(check.ok).toBe(false);
    expect(check.pages).toEqual(['/todo']);
  });

  it('leaves out likes, surface notes, old notes and notes already linked', () => {
    const check = checkRuleRequest(
      [
        note('a', '/todo'),
        note('b', '/jobs'),
        note('like', '/vault', { kind: 'like' }),
        note('surface', '/preview?s=x'),
        note('old', '/learn', { created_at: '2026-08-01T00:00:00Z' }),
        note('linked', '/goals', { spec_change_id: 'c-1' }),
      ],
      NOW,
    );
    expect(check.ok).toBe(false);
    expect(check.leftOut.map((l) => l.id)).toEqual(['like', 'surface', 'old', 'linked']);
  });

  it('needs at least one open note', () => {
    const closed = { status: 'done' };
    const check = checkRuleRequest(
      [note('a', '/todo', closed), note('b', '/jobs', closed), note('c', '/vault', closed)],
      NOW,
    );
    expect(check.ok).toBe(false);
    expect(check.why).toContain('already closed');
  });
});

describe('noteRuleSql', () => {
  const input = {
    userId: 'u-1',
    spec: 'core-and-dash',
    section: 'Rules',
    finding: 'Three pages were asked to confirm before deleting.',
    sessionId: null,
    notes: [note('aaaaaaaa-1', '/todo'), note('bbbbbbbb-2', '/jobs'), note('cccccccc-3', '/vault')],
    change: { title: 'Every delete asks first', why: 'Three notes asked for it.', diff: DIFF },
  };

  it('cites each note by short id, page and date', () => {
    expect(ruleEvidence(input.notes)).toBe(
      'Notes aaaaaaaa on /todo (2026-09-20), bbbbbbbb on /jobs (2026-09-20), cccccccc on /vault (2026-09-20).',
    );
  });

  it('drafts behind the five-waiting guard and files a missing_rule finding outside any audit', () => {
    const sql = noteRuleSql(input);
    expect(sql).toContain("status = 'proposed') < 5");
    expect(sql).toContain("'missing_rule'");
    expect(sql).toMatch(/select \$o\$u-1\$o\$, null, null, \$o\$core-and-dash\$o\$/);
    expect(sql.match(/insert into spec_changes/g)).toHaveLength(1);
    expect(sql.match(/insert into spec_findings/g)).toHaveLength(1);
  });

  it('refuses a diff over the cap', () => {
    const long = DIFF + '\n' + Array.from({ length: 60 }, (_, i) => `+line ${i}`).join('\n');
    expect(noteRuleProblem({ ...input, change: { ...input.change, diff: long } })).toContain('61');
    expect(noteRuleProblem(input)).toBeNull();
  });
});
