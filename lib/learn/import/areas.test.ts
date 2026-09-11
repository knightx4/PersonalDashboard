import { describe, expect, it, vi } from 'vitest';
import { MAX_AREAS, MIN_AREAS, nameAreas } from './areas';
import { LEARN_OPERATIONS } from '@/lib/learn/spend';

/**
 * What comes back when a topic turns out to be too broad to plan.
 *
 * The planner's tests cover the refusal; these cover what is offered instead.
 * The case that carries the weight is the string that names no subject at all,
 * because this call runs after breadth has already been judged and so has
 * every reason to assume there is a field in there somewhere. "asdf" and
 * "economics" have to come back differently, or somebody gets four plausible
 * lines about nothing and picks one.
 */

function areasFrom(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Area ${i}`,
    covers: `What area ${i} covers.`,
  }));
}

function clientReturning(input: unknown) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_areas', input }],
    usage: { input_tokens: 300, output_tokens: 120 },
  });
  return { client: { messages: { create } } as never, create };
}

const ask = (client: unknown, onSpend?: (report: { model: string }) => void) =>
  nameAreas({ topic: 'economics', anthropicApiKey: 'test', client: client as never, onSpend });

describe('naming the areas inside a broad topic', () => {
  it('comes back with each area and the line under it', async () => {
    const { client } = clientReturning({
      areas: [
        { name: 'How prices get set', covers: 'Supply, demand, and what a price is doing.' },
        { name: 'What a central bank does', covers: 'Rates, reserves, and why they move.' },
        { name: 'Trade between countries', covers: 'Why countries trade and who gains.' },
        { name: 'How growth happens', covers: 'What makes an economy bigger over decades.' },
      ],
    });
    const result = await ask(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areas.length).toBeGreaterThanOrEqual(MIN_AREAS);
    expect(result.areas[0]).toEqual({
      name: 'How prices get set',
      covers: 'Supply, demand, and what a price is doing.',
    });
    for (const area of result.areas) expect(area.covers).not.toBe('');
  });

  it('asks for four to eight, and caps a longer list at eight', async () => {
    // Picking between twenty areas is the problem this was meant to solve, in
    // a new costume.
    const { client, create } = clientReturning({ areas: areasFrom(20) });
    const result = await ask(client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.areas).toHaveLength(MAX_AREAS);
    expect(create.mock.calls[0][0].messages[0].content).toContain(`${MIN_AREAS} and ${MAX_AREAS}`);
  });

  it('drops an area with nothing said about it', async () => {
    // A bare name puts somebody back where they started: guessing what is
    // inside it.
    const { client } = clientReturning({
      areas: [{ name: 'How prices get set', covers: 'What a price is doing.' }, { name: 'Macro' }],
    });
    const result = await ask(client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.areas.map((area) => area.name)).toEqual(['How prices get set']);
  });

  it('keeps one area when it is named twice', async () => {
    const { client } = clientReturning({
      areas: [
        { name: 'Trade between countries', covers: 'Who gains from trade.' },
        { name: 'trade between countries', covers: 'Tariffs and quotas.' },
      ],
    });
    const result = await ask(client);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.areas).toHaveLength(1);
  });

  it('does no searching', async () => {
    // The whole reason this call is cheap next to the planner. Each area is
    // sourced later, on its own, and only if it is kept.
    const { client, create } = clientReturning({ areas: areasFrom(4) });
    await ask(client);

    const tools = create.mock.calls[0][0].tools as { type?: string; name: string }[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('report_areas');
  });

  it('reports what it cost, under an operation the spend screen knows', async () => {
    const reports: { model: string }[] = [];
    const { client } = clientReturning({ areas: areasFrom(5) });
    await ask(client, (report) => reports.push(report));

    expect(reports).toHaveLength(1);
    expect(reports[0].model).toBe('claude-sonnet-5');
    expect(LEARN_OPERATIONS).toContain('name-areas');
  });
});

describe('when there is nothing inside it', () => {
  it('says a string is not a subject rather than inventing areas', async () => {
    const { client } = clientReturning({ areas: [], not_a_subject: true });
    const result = await ask(client);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not-a-subject');
      expect(result.detail).toMatch(/subject/i);
    }
  });

  it('ignores areas returned alongside that admission', async () => {
    // A model that says both has contradicted itself, and the half to trust
    // is the admission.
    const { client } = clientReturning({ areas: areasFrom(4), not_a_subject: true });
    const result = await ask(client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-a-subject');
  });

  it('reports an empty answer distinctly from breaking', async () => {
    const { client } = clientReturning({ areas: [] });
    const result = await ask(client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-areas');
  });

  it('does not throw when the call fails', async () => {
    const broken = { messages: { create: vi.fn().mockRejectedValue(new Error('overloaded')) } };
    const result = await ask(broken);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });

  it('does not throw when the answer comes back malformed', async () => {
    const { client } = clientReturning({ areas: [{ covers: 'A line with nothing it belongs to.' }] });
    const result = await ask(client);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });
});
