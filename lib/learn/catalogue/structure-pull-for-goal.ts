import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type postgres from 'postgres';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { pullOcwForGoal } from '@/lib/learn/catalogue/ocw-structure-pull';
import type { StructureDocumentInput } from '@/lib/learn/catalogue/structure';
import { storeStructure } from '@/lib/learn/catalogue/structure-store';
import { providersForKind, type GoalKind, type GoalToClassify, type ProviderId } from '@/lib/learn/goal-kind';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { fetchArxivStructure, parseArxivId } from '@/lib/learn/providers/arxiv';
import { EXPLAINER_HOSTS, explainerHostFor, pullExplainer } from '@/lib/learn/providers/explainers';
import { parseOpenstaxSlug, fetchOpenstaxStructure } from '@/lib/learn/providers/openstax';
import { PRACTICAL_SOURCES, practicalSourceFor, pullPractical } from '@/lib/learn/providers/practical';
import { pullYaleCourse } from '@/lib/learn/providers/yale';

/**
 * Pulling the structure documents a goal's kind calls for, at draft time
 * (plan #2247.10, on the providers of #2247.3 to #2247.9).
 *
 * The kind names the providers in order (lib/learn/goal-kind.ts). Each one
 * with code runs here; one without is listed as skipped, never tried some
 * other way. Every provider follows the feature's rule: a model proposes, a
 * fetch confirms, and only what was fetched is stored.
 *
 *   ocw                   pullOcwForGoal: its own proposing call and the sitemap
 *   yale                  course pages on oyc.yale.edu, confirmed by pullYaleCourse
 *   openstax              book slugs, confirmed by fetchOpenstaxStructure (never_feed)
 *   arxiv                 arXiv ids, confirmed by fetchArxivStructure, 3 s apart
 *   primary_sources       pages on the explainer allowlist, by pullExplainer
 *   official_explainers   the same allowlist
 *   extension             pages on the practical allowlist, by pullPractical
 *   certification         the same allowlist
 *   ut_austin             not here yet: #2247.4 adds its puller to PULLERS
 *   monographs, frame     no code; skipped
 *
 * For every provider but OCW the proposing call is the one below, told what
 * kind of identifier that provider takes. One Haiku call per provider, under
 * the spend operation 'propose-structure-sources'; OCW's proposing call is
 * reported through the same sink.
 */

export const PROPOSE_MODEL = MODELS.learnStructurePropose;
const TOOL_NAME = 'report_candidates';
/** Candidates one provider proposes. Each costs one to thirty fetches to confirm. */
export const MAX_CANDIDATES = 3;
/** arXiv asks for about three seconds between requests. */
const ARXIV_GAP_MS = 3_000;

type Pulled = { ok: true; document: StructureDocumentInput } | { ok: false; detail: string };

/** A provider whose candidates the generic call proposes. */
export type CandidateProvider = {
  id: ProviderId;
  /** What to name, said to the model: the identifier and where it comes from. */
  ask: string;
  /** The candidate as the puller takes it, or null when it is not written like one. */
  read: (value: string) => string | null;
  /** Fetch and parse; confirms the candidate exists. */
  pull: (candidate: string) => Promise<Pulled>;
  /** Wait this long between two pulls. */
  gapMs?: number;
};

const hostList = (hosts: readonly { host: string }[]) => [...new Set(hosts.map((h) => `https://${h.host}/`))].join(', ');

const ALLOWLISTED_EXPLAINERS = `Name pages on these sites only: ${hostList(EXPLAINER_HOSTS)}. The Federal Reserve's "The Fed Explained" index (https://www.federalreserve.gov/aboutthefed/the-fed-explained.htm) and the Avalon Project's century menus (https://avalon.law.yale.edu/subject_menus/18th.asp and the like) are what is read.`;
const ALLOWLISTED_PRACTICAL = `Name pages on these sites only: ${hostList(PRACTICAL_SOURCES)}. Extension short-course pages and certification exam outlines are what is read.`;

export const CANDIDATE_PROVIDERS: Partial<Record<ProviderId, CandidateProvider>> = {
  yale: {
    id: 'yale',
    ask: 'Name Open Yale Courses course pages, written as their address: https://oyc.yale.edu/<subject>/<course code>, such as https://oyc.yale.edu/history/hist-116.',
    read: (value) => (/^https:\/\/oyc\.yale\.edu\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(value.trim()) ? value.trim() : null),
    pull: async (url) => pullYaleCourse(url),
  },
  openstax: {
    id: 'openstax',
    ask: 'Name OpenStax textbooks by their slug, as in https://openstax.org/details/books/<slug>: "principles-economics-3e", "us-history".',
    read: (value) => parseOpenstaxSlug(value),
    pull: async (slug) => fetchOpenstaxStructure(slug),
  },
  arxiv: {
    id: 'arxiv',
    ask: 'Name arXiv lecture notes, reviews or surveys that lay the subfield out section by section, by arXiv id: "2301.00001" or "hep-th/9901001".',
    read: (value) => parseArxivId(value),
    pull: async (id) => fetchArxivStructure(id),
    gapMs: ARXIV_GAP_MS,
  },
  primary_sources: {
    id: 'primary_sources',
    ask: `Name primary-source index pages that collect the documents of this subject. ${ALLOWLISTED_EXPLAINERS}`,
    read: (value) => (explainerHostFor(value.trim()) ? value.trim() : null),
    pull: async (url) => pullExplainer(url),
  },
  official_explainers: {
    id: 'official_explainers',
    ask: `Name official explainer pages from the institution itself. ${ALLOWLISTED_EXPLAINERS}`,
    read: (value) => (explainerHostFor(value.trim()) ? value.trim() : null),
    pull: async (url) => pullExplainer(url),
  },
  extension: {
    id: 'extension',
    ask: `Name cooperative extension short-course pages that teach this skill lesson by lesson. ${ALLOWLISTED_PRACTICAL}`,
    read: (value) => (practicalSourceFor(value.trim()) ? value.trim() : null),
    pull: async (url) => pullPractical(url),
  },
  certification: {
    id: 'certification',
    ask: `Name certification exam outlines for this skill. ${ALLOWLISTED_PRACTICAL}`,
    read: (value) => (practicalSourceFor(value.trim()) ? value.trim() : null),
    pull: async (url) => pullPractical(url),
  },
};

/** The providers with code, ocw included. */
export function wiredProviders(): ProviderId[] {
  return ['ocw', ...(Object.keys(CANDIDATE_PROVIDERS) as ProviderId[])];
}

const SYSTEM = `You name documents whose structure (weeks, chapters, sections, lessons)
would lay out one person's learning goal. Each one you name is fetched to
confirm it, so name only what you are confident exists, written exactly as
asked. Fewer good ones are better than more weak ones; name none if nothing
fits. At most ${MAX_CANDIDATES}, best first. Report them through ${TOOL_NAME}.`;

/** Read the tool payload: each value the provider can read, first mention kept, at most MAX_CANDIDATES. Pure. */
export function readCandidates(input: unknown, read: (value: string) => string | null): string[] {
  const list = (input as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    const raw = (entry as { value?: unknown } | null)?.value;
    const value = typeof raw === 'string' ? read(raw) : null;
    if (!value || out.includes(value)) continue;
    out.push(value);
    if (out.length === MAX_CANDIDATES) break;
  }
  return out;
}

/** The user message for one goal and one provider. Exported for the test. */
export function candidatePrompt(goal: GoalToClassify, provider: CandidateProvider): string {
  const about = goal.about?.trim();
  return `Goal: ${goal.name.trim()}${about ? `. ${about}` : ''}\n\n${provider.ask}\n\nCall ${TOOL_NAME}.`;
}

export async function proposeCandidates(input: {
  goal: GoalToClassify;
  provider: CandidateProvider;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<{ ok: true; candidates: string[] } | { ok: false; detail: string }> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: PROPOSE_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the documents to fetch, best first.',
          input_schema: {
            type: 'object',
            properties: {
              candidates: {
                type: 'array',
                maxItems: MAX_CANDIDATES,
                items: {
                  type: 'object',
                  properties: { value: { type: 'string' }, title: { type: 'string' } },
                  required: ['value'],
                },
              },
            },
            required: ['candidates'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, PROPOSE_MODEL),
      messages: [{ role: 'user', content: candidatePrompt(input.goal, input.provider) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The proposing call failed.' };
  }
  input.onSpend?.({ model: PROPOSE_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return { ok: true, candidates: readCandidates(block.input, input.provider.read) };
}

export type PullLine =
  | { candidate: string; status: 'stored'; itemId: string; units: number; unchanged: boolean }
  | { candidate: string; status: 'not-confirmed'; detail: string }
  | { candidate: string; status: 'failed'; detail: string };

export type ProviderRun = { provider: ProviderId; ok: true; lines: PullLine[] } | { provider: ProviderId; ok: false; detail: string };

export type GoalStructurePull = {
  ran: ProviderRun[];
  /** Providers the kind names that have no code yet. */
  skipped: ProviderId[];
};

/** The ports a pull runs through, so a test runs one without the web, a model or a database. */
export type GoalPullPorts = {
  propose: (provider: CandidateProvider) => Promise<{ ok: true; candidates: string[] } | { ok: false; detail: string }>;
  store: (document: StructureDocumentInput) => Promise<{ itemId: string; unchanged: boolean }>;
  ocw: () => Promise<ProviderRun>;
  wait: (ms: number) => Promise<void>;
};

export function liveGoalPullPorts(input: {
  sql: postgres.Sql;
  goal: GoalToClassify;
  anthropicApiKey: string;
  onSpend?: SpendSink;
}): GoalPullPorts {
  return {
    propose: (provider) => proposeCandidates({ ...input, provider }),
    store: (document) => storeStructure(input.sql, document),
    ocw: async () => {
      const pulled = await pullOcwForGoal(input);
      if (!pulled.ok) return { provider: 'ocw', ok: false, detail: pulled.detail };
      return {
        provider: 'ocw',
        ok: true,
        lines: pulled.lines.map((line): PullLine =>
          line.status === 'stored'
            ? { candidate: line.number, status: 'stored', itemId: line.itemId, units: line.units, unchanged: line.unchanged }
            : line.status === 'failed'
              ? { candidate: line.number, status: 'failed', detail: line.detail }
              : { candidate: line.number, status: 'not-confirmed', detail: line.status },
        ),
      };
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/** One provider's candidates, confirmed and stored one at a time. Never throws for one candidate. */
export async function pullCandidates(provider: CandidateProvider, ports: GoalPullPorts): Promise<ProviderRun> {
  const proposed = await ports.propose(provider);
  if (!proposed.ok) return { provider: provider.id, ok: false, detail: proposed.detail };
  const lines: PullLine[] = [];
  for (const [i, candidate] of proposed.candidates.entries()) {
    if (i > 0 && provider.gapMs) await ports.wait(provider.gapMs);
    try {
      const pulled = await provider.pull(candidate);
      if (!pulled.ok) {
        lines.push({ candidate, status: 'not-confirmed', detail: pulled.detail });
        continue;
      }
      const stored = await ports.store(pulled.document);
      lines.push({ candidate, status: 'stored', itemId: stored.itemId, units: pulled.document.units.length, unchanged: stored.unchanged });
    } catch (error) {
      lines.push({ candidate, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return { provider: provider.id, ok: true, lines };
}

/**
 * Pull what a goal's kind calls for, provider by provider in the kind's order.
 * A goal with no kind pulls nothing: the kind is read first, so a draft never
 * falls back to trying everything.
 */
export async function pullStructureForGoal(kind: GoalKind | null, ports: GoalPullPorts): Promise<GoalStructurePull> {
  const out: GoalStructurePull = { ran: [], skipped: [] };
  for (const id of providersForKind(kind)) {
    if (id === 'ocw') {
      out.ran.push(await ports.ocw());
      continue;
    }
    const provider = CANDIDATE_PROVIDERS[id];
    if (!provider) {
      out.skipped.push(id);
      continue;
    }
    out.ran.push(await pullCandidates(provider, ports));
  }
  return out;
}

/** Documents a pull stored, new or unchanged. */
export function storedCount(pull: GoalStructurePull): number {
  return pull.ran.reduce((n, run) => n + (run.ok ? run.lines.filter((l) => l.status === 'stored').length : 0), 0);
}
