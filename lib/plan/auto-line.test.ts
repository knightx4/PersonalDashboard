import { describe, expect, it } from 'vitest';
import {
  ACTION_GAP_MS,
  briefRunId,
  EMPTY_STATE,
  lineForThought,
  lineForTool,
  newestThought,
  runIdIn,
  runMarker,
  worthWriting,
} from './auto-line';

const RUN = '5937de32-5848-419f-9068-cf39068248a7';
const CWD = '/home/user/PersonalDashboard';

const entry = (type: string, content: unknown, uuid = `u-${Math.random()}`) =>
  JSON.stringify({ type, uuid, message: { content } });

describe('the run marker', () => {
  it('reads back the id it wrote', () => {
    expect(runIdIn(`Build feature #1985.\n\n${runMarker(RUN)}`)).toBe(RUN);
    expect(runIdIn('Build feature #1985.')).toBeNull();
  });

  it('takes the run from the first message only', () => {
    expect(
      briefRunId([
        entry('user', [{ type: 'text', text: `Work #1985.\n\n${runMarker(RUN)}` }]),
        entry('user', `quoted: ${runMarker('00000000-0000-0000-0000-000000000000')}`),
      ]),
    ).toBe(RUN);
    expect(briefRunId([entry('user', 'Hello'), entry('user', runMarker(RUN))])).toBeNull();
  });
});

describe('lineForTool', () => {
  it('names the file an edit touched, inside the repository', () => {
    expect(
      lineForTool({
        tool: 'Edit',
        input: { file_path: `${CWD}/app/dev/plan/runner-crew.tsx` },
        cwd: CWD,
      }),
    ).toEqual({ kind: 'action', body: 'Editing app/dev/plan/runner-crew.tsx' });
    expect(
      lineForTool({ tool: 'Write', input: { file_path: `${CWD}/a.ts` }, cwd: CWD })?.body,
    ).toBe('Writing a.ts');
  });

  it('writes nothing for reads and looking commands', () => {
    expect(lineForTool({ tool: 'Read', input: { file_path: 'x' } })).toBeNull();
    expect(lineForTool({ tool: 'Bash', input: { command: 'git status --short' } })).toBeNull();
    expect(
      lineForTool({ tool: 'Bash', input: { command: 'cd /x && grep -n foo bar' } }),
    ).toBeNull();
    expect(
      lineForTool({ tool: 'Bash', input: { command: 'npx tsx scripts/plan.ts show 1985.2' } }),
    ).toBeNull();
  });

  it('says a claim and a close always', () => {
    expect(
      lineForTool({ tool: 'Bash', input: { command: 'npx tsx scripts/plan.ts start 1985.2' } }),
    ).toEqual({
      kind: 'action',
      body: 'Claimed #1985.2',
      always: true,
    });
    expect(
      lineForTool({
        tool: 'Bash',
        input: { command: 'npx tsx scripts/plan.ts done 1985.2 --note "x"' },
      })?.body,
    ).toBe('Closed #1985.2');
  });

  it('names a commit by its short sha and subject', () => {
    expect(
      lineForTool({
        tool: 'Bash',
        input: { command: 'git commit -qm "x"' },
        output: '[claude/branch 5724f5e] Fill every free runner slot in one tick\n 5 files changed',
      }),
    ).toEqual({
      kind: 'action',
      body: 'Committed 5724f5e: Fill every free runner slot in one tick',
      always: true,
    });
  });

  it('reads the gate result, and a failure is an error', () => {
    expect(
      lineForTool({
        tool: 'Bash',
        input: { command: 'npm run gate' },
        output: 'gate: FAILED at Typecheck\n',
      }),
    ).toEqual({ kind: 'error', body: 'The gate failed at Typecheck', always: true });
    expect(
      lineForTool({
        tool: 'Bash',
        input: { command: 'npm run gate' },
        output: 'gate: all clear (519s)',
      })?.body,
    ).toBe('The gate is all clear');
  });

  it('uses the command description when there is one', () => {
    expect(
      lineForTool({
        tool: 'Bash',
        input: { command: 'npx vitest run lib', description: 'Run the lib tests' },
      }),
    ).toEqual({ kind: 'action', body: 'Run the lib tests' });
  });

  it('names a push and a rejected one', () => {
    expect(
      lineForTool({ tool: 'Bash', input: { command: 'git push -q origin HEAD:main' } })?.body,
    ).toBe('Pushed to main');
    expect(
      lineForTool({
        tool: 'Bash',
        input: { command: 'git push origin HEAD:main' },
        output: '! [rejected]',
      })?.kind,
    ).toBe('error');
  });
});

describe('thoughts', () => {
  it('takes Dash’s newest words and leaves out filler', () => {
    const transcript = [
      entry(
        'assistant',
        [{ type: 'text', text: 'Older words that were already written down.' }],
        'a',
      ),
      entry('user', [{ type: 'tool_result', content: 'ok' }]),
      entry(
        'assistant',
        [
          {
            type: 'text',
            text: 'The tick returns after one fire, so I will loop until the slots are full.',
          },
          { type: 'tool_use', name: 'Edit' },
        ],
        'b',
      ),
    ];
    expect(newestThought(transcript)).toEqual({
      id: 'b',
      words: 'The tick returns after one fire, so I will loop until the slots are full.',
    });
    expect(lineForThought('Now the tests.')).toBeNull();
  });
});

describe('worthWriting', () => {
  const state = { ...EMPTY_STATE, lastBody: 'Editing a.ts', lastAt: 1_000 };

  it('leaves out a repeat and a quick second action', () => {
    expect(
      worthWriting({ kind: 'action', body: 'Editing a.ts' }, state, 1_000 + ACTION_GAP_MS),
    ).toBe(false);
    expect(worthWriting({ kind: 'action', body: 'Editing b.ts' }, state, 2_000)).toBe(false);
    expect(
      worthWriting({ kind: 'action', body: 'Editing b.ts' }, state, 1_000 + ACTION_GAP_MS),
    ).toBe(true);
  });

  it('always writes a claim, a commit, a thought and an error', () => {
    expect(worthWriting({ kind: 'action', body: 'Claimed #1', always: true }, state, 2_000)).toBe(
      true,
    );
    expect(
      worthWriting({ kind: 'thought', body: 'Something worth saying here.' }, state, 2_000),
    ).toBe(true);
    expect(worthWriting({ kind: 'error', body: 'The gate failed' }, state, 2_000)).toBe(true);
  });
});
