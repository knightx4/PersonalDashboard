import { describe, expect, it, vi } from 'vitest';
import {
  conceptsFromCourse,
  courseLabel,
  isVagueTitle,
  type CourseForReading,
} from './from-course';

/**
 * Proposing the ideas a transcript course covered (plan #1390).
 *
 * The model is stubbed. What is checked is what happens around it: each idea
 * names the course, ideas the track already holds are not proposed again, and
 * a title with nothing in it gets a message instead of a list.
 */

function clientReturning(input: unknown, usage?: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_chain', input }],
        usage,
      }),
    },
  } as never;
}

function createOf(client: unknown) {
  return (client as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create;
}

const COURSE: CourseForReading = {
  school: 'University of Somewhere',
  code: 'ECON 201',
  title: 'Intermediate Macroeconomics',
  term: 'Fall',
  year: 2017,
  grade: 'B+',
};

const ISLM = 'Output and the interest rate settle where goods and money markets both clear';
const PHILLIPS = 'Inflation and unemployment trade off in the short run';
const NAIRU = 'The trade-off disappears once expectations catch up';

const CHAIN = {
  subject: 'Economics',
  goal_concept: NAIRU,
  concepts: [
    {
      name: ISLM,
      claim: 'The IS-LM model finds output and the rate where both markets clear at once.',
      basis: 'The central model of any intermediate macro course.',
    },
    {
      name: PHILLIPS,
      claim: 'In the short run, lower unemployment comes with higher inflation.',
      basis: 'Taught in every intermediate macro course.',
    },
    {
      name: NAIRU,
      claim: 'Once wage expectations adjust, unemployment returns to its natural rate whatever inflation is.',
      basis: 'The standard follow-on to the Phillips curve.',
    },
  ],
  edges: [
    { prerequisite: ISLM, dependent: PHILLIPS, basis: 'The curve is read off the demand side.' },
    { prerequisite: PHILLIPS, dependent: NAIRU, basis: 'The long run qualifies the short-run trade-off.' },
  ],
};

const ask = (
  client: unknown,
  options: {
    course?: CourseForReading;
    subject?: string | null;
    existing?: { id: string; name: string }[];
    tracks?: string[];
    existingIn?: (track: string) => Promise<{ id: string; name: string }[]>;
    onSpend?: (report: unknown) => void;
  } = {},
) =>
  conceptsFromCourse({
    course: options.course ?? COURSE,
    subject: options.subject === undefined ? 'Economics' : options.subject,
    existing: options.existing ?? [],
    tracks: options.tracks,
    existingIn: options.existingIn,
    anthropicApiKey: 'test',
    client: client as never,
    onSpend: options.onSpend,
  });

describe('an ordinary course', () => {
  it('comes back as proposed ideas with the course named on each', async () => {
    const result = await ask(clientReturning(CHAIN));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chain.nodes.map((node) => node.name)).toEqual([ISLM, PHILLIPS, NAIRU]);
    for (const node of result.chain.nodes) {
      expect(node.basis.startsWith('From ECON 201, Intermediate Macroeconomics, Fall 2017, grade B+.')).toBe(true);
    }
    expect(result.chain.nodes[0].basis).toContain('The central model');
  });

  it('gives the model the course and the track, on Sonnet', async () => {
    const client = clientReturning(CHAIN);
    await ask(client);

    const call = createOf(client).mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-5');
    const content = call.messages[0].content as string;
    expect(content).toContain('Subject: Economics');
    expect(content).toContain('- Code: ECON 201');
    expect(content).toContain('- Title: Intermediate Macroeconomics');
    expect(content).toContain('- Term: Fall 2017');
  });

  it('reports what it spent', async () => {
    const spend = vi.fn();
    await ask(clientReturning(CHAIN, { input_tokens: 900, output_tokens: 400 }), { onSpend: spend });
    expect(spend).toHaveBeenCalledTimes(1);
    expect(spend.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });
});

describe('a course going into a track that already holds some of its ideas', () => {
  const HELD = { id: '5f1c0f2e-0000-4000-8000-000000000001', name: ISLM };

  it('leaves out the ideas the track already holds', async () => {
    const result = await ask(clientReturning(CHAIN), { existing: [HELD] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proposed = result.chain.nodes.filter((node) => node.existingId === null);
    expect(proposed.map((node) => node.name)).toEqual([PHILLIPS, NAIRU]);

    // The held idea rides along only as the anchor the new ones join to, with
    // its own basis, and nothing is written for it on approval.
    const anchor = result.chain.nodes.find((node) => node.name === ISLM);
    expect(anchor?.existingId).toBe(HELD.id);
    expect(anchor?.basis).not.toContain('From ECON 201');
    expect(result.chain.joined).toBe(1);
  });

  it('tells the model what the track holds, by name', async () => {
    const client = clientReturning(CHAIN);
    await ask(client, { existing: [HELD] });
    const content = createOf(client).mock.calls[0][0].messages[0].content as string;
    expect(content).toContain(`- ${ISLM}`);
    expect(content).not.toContain(HELD.id);
  });

  it('says so when every idea is already held', async () => {
    const existing = [ISLM, PHILLIPS, NAIRU].map((name, i) => ({
      id: `5f1c0f2e-0000-4000-8000-00000000000${i}`,
      name,
    }));
    const result = await ask(clientReturning(CHAIN), { existing });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('nothing-new');
  });

  it('with no track picked, matches the one the model chose among theirs', async () => {
    const client = clientReturning({ ...CHAIN, subject: 'economics' });
    const existingIn = vi.fn().mockResolvedValue([HELD]);
    const result = await ask(client, {
      subject: null,
      tracks: ['Economics', 'Statistics'],
      existingIn,
    });

    const content = createOf(client).mock.calls[0][0].messages[0].content as string;
    expect(content).not.toContain('Subject:');
    expect(content).toContain('- Statistics');
    expect(existingIn).toHaveBeenCalledWith('Economics');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chain.subject).toBe('Economics');
    expect(result.chain.nodes.filter((node) => node.existingId === null)).toHaveLength(2);
  });

  it('with no track picked, keeps a new track the model named', async () => {
    const existingIn = vi.fn();
    const result = await ask(clientReturning({ ...CHAIN, subject: 'Macroeconomics' }), {
      subject: null,
      tracks: ['Statistics'],
      existingIn,
    });
    expect(existingIn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.chain.subject).toBe('Macroeconomics');
  });
});

describe('a vague title', () => {
  it('gets a message pointing at the written form instead of a list, without a call', async () => {
    const client = clientReturning(CHAIN);
    const result = await ask(client, {
      course: { ...COURSE, code: 'ECON 499', title: 'Special Topics' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too-vague');
      expect(result.detail).toContain('Special Topics');
      expect(result.detail).toContain('what you already know');
    }
    expect(createOf(client)).not.toHaveBeenCalled();
  });

  it('gets the same message when the model says the title is too vague', async () => {
    const result = await ask(
      clientReturning({ ...CHAIN, too_vague: true, concepts: [], edges: [] }),
      { course: { ...COURSE, title: 'Perspectives' } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too-vague');
      expect(result.detail).toContain('what you already know');
    }
  });

  it('knows a vague title from one with a subject in it', () => {
    for (const title of ['Special topics', 'Independent Study II', 'Senior Thesis', 'Directed Reading 1']) {
      expect(isVagueTitle(title)).toBe(true);
    }
    for (const title of ['Special Topics in Game Theory', 'Advanced Microeconomics', 'Linear Algebra I']) {
      expect(isVagueTitle(title)).toBe(false);
    }
  });
});

describe('when the call goes wrong', () => {
  it('returns the error rather than a message', async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error('overloaded')) },
    } as never;
    const result = await ask(client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.detail).toBe('overloaded');
    }
  });
});

describe('courseLabel', () => {
  it('writes code, title, term, year and grade, leaving out what is missing', () => {
    expect(courseLabel(COURSE)).toBe('ECON 201, Intermediate Macroeconomics, Fall 2017, grade B+');
    expect(courseLabel({ ...COURSE, code: null, grade: null, term: null })).toBe(
      'Intermediate Macroeconomics, 2017',
    );
    expect(courseLabel({ ...COURSE, term: 'Fall 2017' })).toBe(
      'ECON 201, Intermediate Macroeconomics, Fall 2017, grade B+',
    );
  });
});
