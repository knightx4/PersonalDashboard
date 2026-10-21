import { describe, expect, it } from 'vitest';
import { LOOKUP_NOT_RUN } from '@/lib/talk/talk';
import { gradeAnswer, parseExpect, type CaseOutcome } from './grade';
import { dashHealth, PROMPT_TOKENS_ALERT, pushesBack, type HealthTurn } from './health';
import { qualityNote, runDashQuality, type DashQualityPorts } from './run';

const ROLE = { table: 'job_search.applications', ref: 'a-1', title: 'Strategy Lead at Concourse', href: '/jobs/roles/r-1' };

function answered(body: string, extra: Partial<Extract<CaseOutcome, { ok: true }>> = {}): CaseOutcome {
  return { ok: true, body, stop: 'answered', citations: [ROLE], toolCalls: [{ name: 'search', input: {}, result: { ok: true, rows: [] } }], seconds: 8, ...extra };
}

describe('grading an answer', () => {
  it('passes an answer that shows what the case expects', () => {
    const expect_ = parseExpect({ mentions_all: ['concourse'], cites_any: ['Concourse'], max_lookups: 4 });
    expect(gradeAnswer(expect_, answered('You applied to one role at Concourse.'))).toEqual([]);
  });

  it('counts a name as shown when it is only in a cited row', () => {
    expect(gradeAnswer(parseExpect({ mentions_all: ['Strategy Lead'] }), answered('One role.'))).toEqual([]);
  });

  it('fails the Concourse answer of 21 October on every count it broke', () => {
    const outcome = answered('I could not finish this answer: the model stopped without writing an answer.', {
      stop: 'unfinished',
      citations: [],
      toolCalls: [
        { name: 'search', input: {}, result: { ok: true, rows: [] } },
        { name: 'open_row', input: {}, result: { ok: false, error: LOOKUP_NOT_RUN } },
        { name: 'recall', input: {}, result: { ok: false, error: 'That lookup failed to read the database.' } },
      ],
    });
    const failures = gradeAnswer(parseExpect({ cites_any: ['Concourse'] }), outcome);
    expect(failures.join('\n')).toContain('I could not finish');
    expect(failures.join('\n')).toContain('"unfinished"');
    expect(failures.join('\n')).toContain('1 lookup was refused at a limit');
    expect(failures.join('\n')).toContain('Lookup recall failed');
    expect(failures.join('\n')).toContain('No cited row matches "Concourse"');
  });

  it('holds limits, names to avoid, and the vendor name', () => {
    const outcome = answered('Claude found it. I stopped after 12 lookups, so this answer rests only on what those found.', { seconds: 50 });
    const failures = gradeAnswer(parseExpect({ mentions_none: ['doola'], max_seconds: 30, max_lookups: 0 }), outcome);
    expect(failures).toContain('The answer says "Claude".');
    expect(failures).toContain('A limit cut the answer short.');
    expect(failures).toContain('It took 50 seconds, more than 30.');
    expect(failures).toContain('It took 1 lookup, more than 0.');
  });

  it('lets the vendor name through when it is in a row the lookups returned', () => {
    const outcome = answered('Your list has "Claude Code in practice".', {
      toolCalls: [{ name: 'reading_list', input: {}, result: { ok: true, rows: [{ title: 'Claude Code in practice' }] } }],
    });
    expect(gradeAnswer(parseExpect({}), outcome)).toEqual([]);
  });

  it('fails a run with no answer, and ignores fields it does not know', () => {
    expect(gradeAnswer(parseExpect({ nonsense: 1 }), { ok: false, detail: 'There is no question.', toolCalls: [], seconds: 0 })).toEqual([
      'No answer: There is no question.',
    ]);
    expect(parseExpect('not an object')).toMatchObject({ allow_failed_lookups: false });
  });
});

describe('the day of real answers', () => {
  const turn = (id: string, body: string, calls: HealthTurn['toolCalls'] = [], rating: HealthTurn['rating'] = null): HealthTurn => ({
    id,
    body,
    toolCalls: calls,
    rating,
    ratingNote: rating ? 'wrong company' : null,
  });

  it('is quiet when every answer went well', () => {
    const health = dashHealth([turn('t1', 'Two roles.')], [{ inputTokens: 2, cachedInputTokens: 70_000, cacheWriteTokens: 500, outputTokens: 90, costMicros: 30_000 }]);
    expect(health.alerts).toEqual([]);
    expect(health).toMatchObject({ answers: 1, calls: 1, avgPromptTokens: 70_502, costUsd: 0.03 });
  });

  it('raises a fallback, a limit, a broken lookup at once, a repeated bad argument, a thumbs down and a grown prompt', () => {
    const badArg = { name: 'add_idea', input: {}, result: { ok: false, error: '"dash" is not a workspace.' } };
    const health = dashHealth(
      [
        turn('t1', 'I could not finish this answer: …', [{ name: 'open_row', input: {}, result: { ok: false, error: LOOKUP_NOT_RUN } }]),
        turn('t2', 'Here.\n\nI stopped after 12 lookups, so this answer rests only on what those found.'),
        turn('t3', 'Found.', [{ name: 'recall', input: {}, result: { ok: false, error: 'That lookup failed to read the database.' } }]),
        turn('t4', 'Saved.', [badArg, badArg], 'down'),
      ],
      [{ inputTokens: PROMPT_TOKENS_ALERT, cachedInputTokens: 1, cacheWriteTokens: 0, outputTokens: 1, costMicros: null }],
    );
    expect(health.alerts).toEqual([
      '1 answer fell back to "I could not finish".',
      '1 answer was cut short by a limit.',
      '1 lookup was refused at a limit.',
      'Lookup add_idea failed 2 times: "dash" is not a workspace.',
      'Lookup recall failed 1 time: That lookup failed to read the database.',
      '1 answer was marked down.',
      `Calls averaged 85,001 prompt tokens, above 85,000.`,
    ]);
    expect(health.failedLookups[0]).toMatchObject({ tool: 'add_idea', count: 2, turns: ['t4'] });
  });

  it('hears pushback in the reply after an answer, at no cost', () => {
    for (const reply of ['no, the other one', "that's wrong", 'You missed the Concourse role', 'not what i asked', 'why did you say that', 'still wrong']) {
      expect(pushesBack(reply)).toBe(true);
    }
    for (const reply of ['thanks', 'now do the same for Decagon', 'nothing else', 'know anyone there?']) {
      expect(pushesBack(reply)).toBe(false);
    }
    const health = dashHealth([{ ...turn('t1', 'One role.'), followUp: "That's wrong, I applied to two" }, { ...turn('t2', 'Ok.'), followUp: 'great' }], []);
    expect(health.pushback).toEqual([{ turn: 't1', said: "That's wrong, I applied to two" }]);
    expect(health.alerts).toEqual(['1 answer was pushed back on: "That\'s wrong, I applied to two"']);
  });

  it('counts a lookup that answered with only part of what it was asked, in Ask and from connected apps', () => {
    const partial = { name: 'search', input: {}, result: { ok: true, rows: [], note: 'Matches titles and names only. Could not read: Job search, Todo. 0 matched, showing all.' } };
    const health = dashHealth(
      [turn('t1', 'Nothing found.', [partial])],
      [],
      [
        { id: 'c1', tool: 'search', outcome: 'partial', error: 'Could not read: Job search, Shopping, Todo.' },
        { id: 'c2', tool: 'recall', outcome: 'ok', error: null },
      ],
    );
    expect(health.alerts).toEqual([
      'Lookup search failed 1 time: Could not read: Job search, Todo.',
      'Connected apps: search failed 1 time: Could not read: Job search, Shopping, Todo.',
    ]);
    expect(health.connector).toMatchObject({ calls: 2, failed: [{ tool: 'search', count: 1 }] });
  });

  it('lets one bad argument pass as the model\'s slip', () => {
    const health = dashHealth([turn('t1', 'Ok.', [{ name: 'read_dev_row', input: {}, result: { ok: false, error: '#2072.1 names no step on the plan.' } }])], []);
    expect(health.alerts).toEqual([]);
    expect(health.failedLookups).toHaveLength(1);
  });
});

describe('a run', () => {
  function ports(overrides: Partial<DashQualityPorts> = {}) {
    const notes: string[] = [];
    const finished: unknown[] = [];
    const port: DashQualityPorts = {
      owner: async () => 'owner',
      model: async () => 'claude-sonnet-5-5',
      cases: async () => [
        { id: 'c1', question: 'what roles have i applied to at concourse', expect: { cites_any: ['Concourse'] } },
        { id: 'c2', question: 'what did i spend on books', expect: { mentions_all: ['£12'] } },
      ],
      ask: async (_user, question) => ({
        outcome: question.includes('concourse') ? answered('One role at Concourse.') : answered('Nothing on books.', { citations: [] }),
        costMicros: 50_000,
      }),
      turns: async () => [],
      spend: async () => [],
      connectorCalls: async () => [],
      start: async () => 'run-1',
      finish: async (_id, row) => {
        finished.push(row);
      },
      writeNote: async (_user, body) => {
        notes.push(body);
        return 'note-1';
      },
      ...overrides,
    };
    return { port, notes, finished };
  }

  it('grades every case, keeps the run, and writes a note naming what failed', async () => {
    const { port, notes, finished } = ports();
    const summary = await runDashQuality(port, { trigger: 'monthly', deploy: 'abc' });
    expect(summary).toEqual({ runId: 'run-1', cases: 2, passed: 1, alerts: 0, noteId: 'note-1' });
    expect(notes[0]).toContain('1 of 2 questions failed');
    expect(notes[0]).toContain('"what did i spend on books": The answer does not mention "£12".');
    expect(notes[0]).not.toMatch(/Claude/);
    expect(finished[0]).toMatchObject({ cases: 2, passed: 1, costMicros: 100_000, noteId: 'note-1', error: null });
  });

  it('writes no note when all is well, and keeps a case that threw as a failure', async () => {
    const quiet = ports({ cases: async () => [{ id: 'c1', question: 'what roles have i applied to at concourse', expect: {} }] });
    expect((await runDashQuality(quiet.port, { trigger: 'manual', deploy: null })).noteId).toBeNull();
    expect(quiet.notes).toEqual([]);

    const threw = ports({
      ask: async () => {
        throw new Error('overloaded');
      },
    });
    const summary = await runDashQuality(threw.port, { trigger: 'manual', deploy: null });
    expect(summary.passed).toBe(0);
    expect(threw.notes[0]).toContain('The run threw: overloaded');
  });

  it('still reports the day when the cases cannot be read', async () => {
    const broken = ports({
      cases: async () => {
        throw new Error('relation does not exist');
      },
    });
    await runDashQuality(broken.port, { trigger: 'monthly', deploy: null });
    expect(broken.notes[0]).toContain('The run could not read its cases: relation does not exist');
  });

  it('asks no case on the free daily run, and says so in the note', async () => {
    let asked = 0;
    const free = ports({
      ask: async () => {
        asked++;
        return { outcome: answered('x'), costMicros: 1 };
      },
      turns: async () => [{ id: 't1', body: 'I could not finish this answer: …', toolCalls: [], rating: 'down', ratingNote: 'useless' }],
    });
    const summary = await runDashQuality(free.port, { trigger: 'health', deploy: null });
    expect(asked).toBe(0);
    expect(summary).toMatchObject({ cases: 0, passed: 0, alerts: 2 });
    expect(free.notes[0].split('\n')[0]).toBe('Dash quality check: 2 alerts from the last day of answers');
    expect(free.finished[0]).toMatchObject({ costMicros: 0 });
  });

  it('asks only the case named on a run by hand', async () => {
    const named: (string | undefined)[] = [];
    const one = ports({
      cases: async (_user, only) => {
        named.push(only);
        return [{ id: 'c1', question: 'what roles have i applied to at concourse', expect: {} }];
      },
    });
    await runDashQuality(one.port, { trigger: 'manual', only: 'c1', deploy: null });
    expect(named).toEqual(['c1']);
  });

  it('has nothing to say for a clean day', () => {
    const health = dashHealth([], []);
    expect(qualityNote([], health, 'r')).toBeNull();
  });
});
