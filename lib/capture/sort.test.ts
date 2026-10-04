/**
 * The capture sorter (plan #1580), on the sentences in fixtures/sort.json.
 *
 * Each case carries the reply the model gave for it; the sort is run with a
 * client that hands that reply back, so what is tested is everything around
 * the model: what it is shown, and how its reply is checked before the box
 * trusts it. scripts/record-capture-sort.ts re-records the replies against
 * Haiku, and this file then says whether Haiku still sorts each case.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { JEV_CONFIDENCE_FLOOR } from '@/lib/jev/decide';
import {
  CAPTURE_PLACES,
  CAPTURE_PLACE_LABELS,
  CAPTURE_SORT_FLOOR,
  availableCapturePlaces,
  captureSortMessage,
  readCaptureSortReply,
  roleName,
  type CapturePlace,
  type CaptureSortContext,
  type CaptureSortGoal,
  type CaptureSortRole,
} from '@/lib/capture/sort';
import { CAPTURE_SORT_TOOL, sortCapture } from '@/lib/capture/sort-model';

type Case = {
  name: string;
  sentence: string;
  expect: { clear: true; parts: Array<{ place: CapturePlace; goal?: string; role?: string }> } | { clear: false };
  recorded: string;
  reply: unknown;
};

const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'lib/capture/fixtures/sort.json'), 'utf8')) as {
  goals: CaptureSortGoal[];
  roles: CaptureSortRole[];
  cases: Case[];
};

const context: CaptureSortContext = { places: CAPTURE_PLACES, goals: fixtures.goals, roles: fixtures.roles };

/** A client that answers every call with `reply` as the tool input, and keeps what it was sent. */
function replying(reply: unknown) {
  const sent: Array<Record<string, unknown>> = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        sent.push(params);
        return {
          content: [{ type: 'tool_use', id: 't1', name: CAPTURE_SORT_TOOL, input: reply }],
          usage: { input_tokens: 300, output_tokens: 40 },
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, sent };
}

describe('the fixture corpus', () => {
  it('has about a dozen sentences, with a text message, a two-thing one and every place', () => {
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(12);
    expect(fixtures.cases.some((c) => c.name === 'text message')).toBe(true);
    expect(fixtures.cases.some((c) => c.expect.clear && c.expect.parts.length === 2)).toBe(true);
    expect(fixtures.cases.filter((c) => !c.expect.clear).length).toBeGreaterThanOrEqual(3);
    const places = new Set(fixtures.cases.flatMap((c) => (c.expect.clear ? c.expect.parts.map((p) => p.place) : [])));
    expect([...places].sort()).toEqual([...CAPTURE_PLACES].sort());
  });
});

describe('sorting each fixture sentence', () => {
  for (const fixture of fixtures.cases) {
    it(`${fixture.expect.clear ? 'files' : 'asks about'} "${fixture.name}"`, async () => {
      const { client } = replying(fixture.reply);
      const sort = await sortCapture(fixture.sentence, context, { client });
      expect(sort).not.toBeNull();
      if (!sort) return;
      if (!fixture.expect.clear) {
        expect(sort.confidence).toBeLessThan(0.8);
        expect(sort.sure).toBe(false);
        return;
      }
      expect(sort.sure).toBe(true);
      expect(
        sort.parts.map((part) => ({
          place: part.place,
          ...(part.goal ? { goal: part.goal.title } : {}),
          ...(part.role ? { role: roleName(part.role) } : {}),
        })),
      ).toEqual(fixture.expect.parts);
    });
  }

  it('files each half of a two-thing sentence with its own words', async () => {
    const fixture = fixtures.cases.find((c) => c.name === 'two things')!;
    const sort = await sortCapture(fixture.sentence, context, replying(fixture.reply));
    expect(sort?.parts.map((p) => p.text)).toEqual(['sent the cover letter to Figma', 'call Sam on Friday']);
    expect(sort?.parts[0].role?.id).toBe('role-figma');
  });
});

describe('what the model is shown', () => {
  it('sends the sentence with goal and role names by ref, and no ids', async () => {
    const { client, sent } = replying({ parts: [{ place: 'todo', text: 'x' }], confidence: 0.9 });
    await sortCapture('buy milk', context, { client });
    const message = JSON.stringify(sent[0].messages);
    expect(message).toContain('g1 Run a half marathon');
    expect(message).toContain('r2 Data Scientist at Figma');
    expect(message).toContain('buy milk');
    expect(message).not.toMatch(/goal-half|role-figma/);
    expect(sent[0].tool_choice).toEqual({ type: 'tool', name: CAPTURE_SORT_TOOL });
  });

  it('offers only the places the account has, in the message and in the tool', async () => {
    const places = availableCapturePlaces(['todo', 'goals']);
    expect(places).toEqual(['todo', 'goals']);
    const { client, sent } = replying({ parts: [{ place: 'todo', text: 'x' }], confidence: 0.9 });
    await sortCapture('the Stripe recruiter called', { ...context, places }, { client });
    const tool = (sent[0].tools as Array<{ input_schema: unknown }>)[0];
    expect(JSON.stringify(tool.input_schema)).toContain('"enum":["todo","goals"]');
    const message = captureSortMessage('x', { ...context, places });
    expect(message).not.toContain('Product Analyst at Stripe');
    expect(message).not.toMatch(/- (jobs|vault):/);
  });

  it('makes no call when nothing is offered or nothing was typed', async () => {
    const { client, sent } = replying({});
    expect(await sortCapture('buy milk', { ...context, places: [] }, { client })).toBeNull();
    expect(await sortCapture('   ', context, { client })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('records what the call cost', async () => {
    const spent: unknown[] = [];
    const { client } = replying({ parts: [{ place: 'todo', text: 'x' }], confidence: 0.9 });
    await sortCapture('buy milk', context, { client, onSpend: (r) => spent.push(r) });
    expect(spent).toHaveLength(1);
  });

  it('comes back null when the call fails, so the box offers the places', async () => {
    const client = {
      messages: {
        create: async () => {
          throw new Error('overloaded');
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>;
    expect(await sortCapture('buy milk', context, { client })).toBeNull();
  });
});

describe('checking the reply', () => {
  it('never files into a place the account does not have', () => {
    const places = availableCapturePlaces(['todo', 'goals', 'jobs']);
    const sort = readCaptureSortReply(
      { parts: [{ place: 'vault', text: 'a quote' }], confidence: 0.95 },
      'a quote',
      { ...context, places },
    );
    expect(sort).toEqual({ parts: [], confidence: 0, sure: false });
  });

  it('asks when the goal or role named is not one of theirs', () => {
    const goal = readCaptureSortReply({ parts: [{ place: 'goals', goal_ref: 'g9' }], confidence: 0.95 }, 'ran', context);
    expect(goal.parts[0]).toMatchObject({ place: 'goals', goal: null, text: 'ran' });
    expect(goal.sure).toBe(false);
    const role = readCaptureSortReply({ parts: [{ place: 'jobs' }], confidence: 0.95 }, 'they called', context);
    expect(role.confidence).toBeLessThan(CAPTURE_SORT_FLOOR);
  });

  it('keeps at most three parts and reads nonsense as nothing', () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ place: 'todo', text: `t${i}` }));
    expect(readCaptureSortReply({ parts: four, confidence: 0.9 }, 'x', context).parts).toHaveLength(3);
    expect(readCaptureSortReply('nonsense', 'x', context)).toEqual({ parts: [], confidence: 0, sure: false });
    expect(readCaptureSortReply({ parts: [{ place: 'todo' }], confidence: 7 }, 'x', context).confidence).toBe(1);
  });
});

describe('the places', () => {
  it('uses the floor the goals box uses', () => {
    expect(CAPTURE_SORT_FLOOR).toBe(JEV_CONFIDENCE_FLOOR);
  });

  it('offers every place before the workspaces are known, and labels each', () => {
    expect(availableCapturePlaces(undefined)).toEqual(CAPTURE_PLACES);
    expect(availableCapturePlaces([])).toEqual([]);
    for (const place of CAPTURE_PLACES) expect(CAPTURE_PLACE_LABELS[place]).toBeTruthy();
  });
});
