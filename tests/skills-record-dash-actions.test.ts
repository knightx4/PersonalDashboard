/**
 * Every skill that writes the person's rows records each write with
 * core.record_dash_action (docs/CORE-AND-DASH-SPEC.md, Part 5, rule R6;
 * plan #1460).
 *
 * Routines write through the Supabase connector, out of the app's sight, so
 * the only thing that puts their changes in core.dash_actions, where Home
 * lists them with an Undo, is the instruction in the skill. This reads every
 * skill under .claude/skills, its SKILL.md and its reference files together,
 * and fails one that shows a write to the person's rows without naming the
 * call. lib/core/skill-writes.ts says which tables count.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { personTablesWritten, skillsMissingRecord, type SkillText } from '@/lib/core/skill-writes';

const SKILLS = join(__dirname, '..', '.claude', 'skills');

function markdownUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return markdownUnder(path);
    return entry.endsWith('.md') ? [path] : [];
  });
}

function readSkills(): SkillText[] {
  return readdirSync(SKILLS)
    .filter((name) => existsSync(join(SKILLS, name, 'SKILL.md')))
    .map((name) => ({
      name,
      text: markdownUnder(join(SKILLS, name))
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n'),
    }));
}

describe('skills record their writes', () => {
  it('every skill that writes the person rows names core.record_dash_action', () => {
    expect(skillsMissingRecord(readSkills())).toEqual([]);
  });

  it('the four routines that write the person rows are among those it reads', () => {
    const writers = readSkills()
      .filter((s) => personTablesWritten(s.text).length > 0 || s.text.includes('core.record_dash_action'))
      .map((s) => s.name);
    expect(writers).toEqual(expect.arrayContaining(['goals', 'dash-backup', 'notes', 'plan']));
  });

  it('fails a skill that writes the person rows without the call', () => {
    const skill = {
      name: 'tidy',
      text: "```sql\nupdate goals.items set status = 'done' where id = '…';\ninsert into ideas (user_id, body) values ('…', '…');\n```",
    };
    expect(skillsMissingRecord([skill])).toEqual([{ name: 'tidy', tables: ['goals.items', 'public.ideas'] }]);
    expect(
      skillsMissingRecord([{ ...skill, text: `${skill.text}\nThen call core.record_dash_action.` }]),
    ).toEqual([]);
  });

  it("passes a skill whose writes are only Dash's own records", () => {
    const skill = {
      name: 'audit',
      text: "insert into spec_findings (user_id) values ('…');\nupdate goals.runs set status = 'done';",
    };
    expect(skillsMissingRecord([skill])).toEqual([]);
  });
});
