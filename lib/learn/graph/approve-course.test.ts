import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposedChain } from '@/lib/learn/graph/chain-payload';

/**
 * Approving a course's ideas (plan #1391): only the ticked ideas are saved and
 * declared known, and the course_reads row is written with the track and the
 * count, adding to an earlier read of the same course into the same track.
 */

const calls: {
  saved: ProposedChain[];
  declared: string[][];
  upserts: { row: Record<string, unknown>; options: unknown }[];
} = { saved: [], declared: [], upserts: [] };
let previousRead: { subject_id: string | null; concepts_added: number } | null = null;
let upsertError: { message: string } | null = null;

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock('@/lib/auth/server', () => ({ requireUser: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/learn/graph/save', () => ({
  saveChain: async (_client: unknown, _user: string, chain: ProposedChain) => {
    calls.saved.push(chain);
    const ids = chain.nodes.filter((node) => !node.existingId).map((node) => `id-${node.name}`);
    return { subjectId: 'track-econ', goalId: null, conceptIds: ids };
  },
  declareKnown: async (_client: unknown, _user: string, ids: string[]) => {
    calls.declared.push(ids);
  },
  existingConcepts: async () => [],
  findOrCreateSubject: async () => ({ id: 'track-econ', placed: true }),
}));
vi.mock('@/lib/learn/auth/server', () => ({
  createLearnClient: async () => ({
    from: (table: string) => {
      expect(table).toBe('course_reads');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: previousRead }) }) }),
        upsert: async (row: Record<string, unknown>, options: unknown) => {
          calls.upserts.push({ row, options });
          return { error: upsertError };
        },
      };
    },
  }),
}));

const { approveFromCourse } = await import('@/app/learn/know/actions');

const COURSE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

const node = (name: string, existingId: string | null = null) => ({
  name,
  claim: `${name} claim`,
  basis: 'From ECON 101, Principles of Economics I, Winter 2018, grade A.',
  mastery: [],
  kind: null,
  existingId,
});

const CHAIN = {
  subject: 'Economics',
  goalConcept: 'Consumer surplus',
  nodes: [
    node('Opportunity cost'),
    node('Supply and demand', '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'),
    node('Elasticity'),
    node('Consumer surplus'),
  ],
  edges: [
    { prerequisite: 'Opportunity cost', dependent: 'Supply and demand', basis: 'Builds on it.' },
    { prerequisite: 'Supply and demand', dependent: 'Elasticity', basis: 'Builds on it.' },
    { prerequisite: 'Supply and demand', dependent: 'Consumer surplus', basis: 'Builds on it.' },
  ],
  mentions: [],
  joined: 1,
  dropped: [],
};

function form(keep: string[]): FormData {
  const data = new FormData();
  data.set('courseId', COURSE);
  data.set('chain', JSON.stringify(CHAIN));
  for (const name of keep) data.append('keep', name);
  return data;
}

beforeEach(() => {
  calls.saved = [];
  calls.declared = [];
  calls.upserts = [];
  previousRead = null;
  upsertError = null;
});

describe('approveFromCourse', () => {
  it('saves only the ticked ideas as known and marks the course read', async () => {
    await expect(
      approveFromCourse({}, form(['Opportunity cost', 'Consumer surplus'])),
    ).rejects.toThrow('redirect:/learn/s/track-econ');

    const names = calls.saved[0].nodes.map((n) => n.name);
    expect(names).toEqual(['Opportunity cost', 'Supply and demand', 'Consumer surplus']);
    expect(calls.declared).toEqual([['id-Opportunity cost', 'id-Consumer surplus']]);
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].row).toMatchObject({
      user_id: 'user-1',
      course_id: COURSE,
      subject_id: 'track-econ',
      concepts_added: 2,
    });
    expect(calls.upserts[0].options).toEqual({ onConflict: 'user_id,course_id' });
  });

  it('adds to the count when the course was read into the same track before', async () => {
    previousRead = { subject_id: 'track-econ', concepts_added: 4 };
    await expect(approveFromCourse({}, form(['Elasticity']))).rejects.toThrow('redirect:');
    expect(calls.upserts[0].row.concepts_added).toBe(5);
  });

  it('writes nothing when every idea is unticked', async () => {
    const result = await approveFromCourse({}, form([]));
    expect(result.message).toMatch(/Nothing ticked/);
    expect(calls.saved).toHaveLength(0);
    expect(calls.upserts).toHaveLength(0);
  });

  it('says so, and stops offering approval, when the course could not be marked read', async () => {
    upsertError = { message: 'boom' };
    const result = await approveFromCourse({}, form(['Opportunity cost']));
    expect(result.savedTo).toBe('track-econ');
    expect(result.error).toMatch(/could not be marked as read/);
  });
});
