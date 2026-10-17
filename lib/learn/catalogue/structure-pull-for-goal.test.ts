import { describe, expect, it, vi } from 'vitest';
import type { StructureDocumentInput } from '@/lib/learn/catalogue/structure';

vi.mock('server-only', () => ({}));

const { CANDIDATE_PROVIDERS, MAX_CANDIDATES, candidatePrompt, pullStructureForGoal, readCandidates, storedCount, wiredProviders } =
  await import('./structure-pull-for-goal');
type Ports = import('./structure-pull-for-goal').GoalPullPorts;

/**
 * The draft-time registry (plan #2247.10): the providers a goal's kind names
 * run in order, each candidate a model proposes is confirmed by a fetch
 * before it is stored, and a provider with no code is skipped.
 */

const doc = (title: string): StructureDocumentInput => ({
  providerSlug: 'test',
  externalId: title,
  title,
  canonicalUrl: `https://example.org/${title}`,
  sourceUrl: `https://example.org/${title}`,
  licenceMode: 'show',
  rawText: title,
  units: [{ label: 'Week 1', heading: title, topics: [], readings: [] }],
});

function ports(proposals: Record<string, string[]>): Ports & { stored: string[]; waits: number[]; proposed: string[] } {
  const stored: string[] = [];
  const waits: number[] = [];
  const proposed: string[] = [];
  return {
    stored,
    waits,
    proposed,
    propose: async (provider) => {
      proposed.push(provider.id);
      return { ok: true, candidates: proposals[provider.id] ?? [] };
    },
    store: async (document) => {
      stored.push(document.title);
      return { itemId: `id-${document.title}`, unchanged: false };
    },
    ocw: async () => ({ provider: 'ocw', ok: true, lines: [{ candidate: '15.431', status: 'stored', itemId: 'ocw-1', units: 12, unchanged: false }] }),
    ut: async () => ({ provider: 'ut_austin', ok: true, lines: [] }),
    wait: async (ms) => {
      waits.push(ms);
    },
  };
}

describe('reading what the proposing call names', () => {
  it('keeps what the provider can read, once each, at most the cap', () => {
    const read = CANDIDATE_PROVIDERS.arxiv!.read;
    const input = {
      candidates: [
        { value: 'https://arxiv.org/abs/2301.00001v2' },
        { value: '2301.00001' },
        { value: 'not an id' },
        { value: 'hep-th/9901001' },
        { value: '1802.05365' },
        { value: '1906.00001' },
      ],
    };
    expect(readCandidates(input, read)).toEqual(['2301.00001', 'hep-th/9901001', '1802.05365'].slice(0, MAX_CANDIDATES));
    expect(readCandidates(null, read)).toEqual([]);
  });

  it('takes only allowlisted pages for the allowlist providers', () => {
    const read = CANDIDATE_PROVIDERS.extension!.read;
    expect(
      readCandidates(
        {
          candidates: [
            { value: 'https://www.uaex.uada.edu/farm-ranch/special-programs/beekeeping/beekeepingshortcourse.aspx' },
            { value: 'https://example.com/beekeeping' },
          ],
        },
        read,
      ),
    ).toHaveLength(1);
    expect(CANDIDATE_PROVIDERS.yale!.read('https://oyc.yale.edu/history/hist-116')).toBe('https://oyc.yale.edu/history/hist-116');
    expect(CANDIDATE_PROVIDERS.yale!.read('https://example.com/history/hist-116')).toBeNull();
  });

  it('tells the call the goal and what to name', () => {
    const prompt = candidatePrompt({ name: 'The American Revolution', about: 'its French ideas' }, CANDIDATE_PROVIDERS.yale!);
    expect(prompt).toContain('Goal: The American Revolution. its French ideas');
    expect(prompt).toContain('oyc.yale.edu');
  });

  it('names each practical page whole, so a SaaS goal can be told the practitioner guides (plan #2247.6)', () => {
    for (const id of ['extension', 'certification'] as const) {
      const ask = CANDIDATE_PROVIDERS[id]!.ask;
      expect(ask).toContain('https://www.forentrepreneurs.com/saas-metrics-2/');
      expect(ask).toContain('https://a16z.com/16-startup-metrics/');
      expect(CANDIDATE_PROVIDERS[id]!.read('https://a16z.com/16-startup-metrics/')).toBe('https://a16z.com/16-startup-metrics/');
    }
  });
});

describe('pulling what a goal’s kind calls for', () => {
  it('runs the kind’s providers in order and skips the ones with no code', async () => {
    const p = ports({});
    const pull = await pullStructureForGoal('academic_course', p);
    expect(pull.ran.map((r) => r.provider)).toEqual(['ocw', 'ut_austin', 'openstax', 'yale']);
    expect(pull.skipped).toEqual([]);
    expect(storedCount(pull)).toBe(1);
  });

  it('pulls nothing for a goal with no kind', async () => {
    const p = ports({});
    expect(await pullStructureForGoal(null, p)).toEqual({ ran: [], skipped: [] });
    expect(p.proposed).toEqual([]);
  });

  it('stores only what the fetch confirmed, and waits between arXiv requests', async () => {
    const pullArxiv = vi.spyOn(CANDIDATE_PROVIDERS.arxiv!, 'pull').mockImplementation(async (id) =>
      id === '2301.00001' ? { ok: true, document: doc('Lecture notes') } : { ok: false, detail: 'not-found' },
    );
    const p = ports({ arxiv: ['2301.00001', '2301.99999'] });
    const pull = await pullStructureForGoal('research_subfield', p);
    expect(p.stored).toEqual(['Lecture notes']);
    expect(p.waits).toEqual([3000]);
    const arxiv = pull.ran.find((r) => r.provider === 'arxiv');
    expect(arxiv && arxiv.ok && arxiv.lines.map((l) => l.status)).toEqual(['stored', 'not-confirmed']);
    pullArxiv.mockRestore();
  });

  it('lists every provider with code', () => {
    expect(wiredProviders().sort()).toEqual(
      ['arxiv', 'certification', 'extension', 'ocw', 'official_explainers', 'openstax', 'primary_sources', 'ut_austin', 'yale'].sort(),
    );
  });
});
