import { firstWiredProvider, type ProviderRun } from '@/lib/learn/catalogue/structure-pull-for-goal';
import type { GoalKind, GoalToClassify, ProviderId } from '@/lib/learn/goal-kind';

/**
 * Pulling a few documents a day for the topics that just lit (plan #2247.11).
 *
 * The store of structure documents grows a little ahead of need: a Level 4
 * topic that has lit and has not been pulled for is classified into one of
 * the six goal kinds, and the first provider of that kind with code runs once.
 * Never a crawl: PULLS_PER_DAY topics at most, one provider each, and a topic
 * is pulled for once (a failed pull is tried again on a later day).
 *
 * This file is the decision and the loop, with every effect behind a port, so
 * a test runs a day without the web, a model or a database. The live ports
 * are in lit-topic-pull-run.ts.
 */

/** The most topics pulled for in one UTC day. */
export const PULLS_PER_DAY = 5;

export type LitTopic = {
  id: string;
  title: string;
  /** The Level 3 parent's title, which tells the classifier which sense of the title is meant. */
  parentTitle: string | null;
  /** When the newest link that counts toward its lighting was found; the newest-lit topics go first. */
  litAt: string | null;
};

export type PullOutcome = 'stored' | 'nothing' | 'failed';

/** What a topic already has: the outcome of an earlier attempt. */
export type PriorPull = { outcome: PullOutcome; pulledOn: string };

/** The UTC day of a date as 2026-10-16. */
export function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The topics to pull for, newest-lit first, at most `allowance`. A topic with
 * an earlier `stored` or `nothing` is done; one that `failed` is tried again,
 * but not on the day it failed. Pure.
 */
export function pickTopics(input: {
  lit: readonly LitTopic[];
  prior: ReadonlyMap<string, PriorPull>;
  today: string;
  allowance: number;
}): LitTopic[] {
  const open = input.lit.filter((topic) => {
    const prior = input.prior.get(topic.id);
    return !prior || (prior.outcome === 'failed' && prior.pulledOn !== input.today);
  });
  const at = (topic: LitTopic) => (topic.litAt ? Date.parse(topic.litAt) : 0) || 0;
  open.sort((a, b) => at(b) - at(a) || a.id.localeCompare(b.id));
  return open.slice(0, Math.max(0, input.allowance));
}

/** What the classifier is told of a topic. */
export function goalOfTopic(topic: LitTopic): GoalToClassify {
  return { name: topic.title, about: topic.parentTitle ? `A topic within ${topic.parentTitle}.` : null };
}

export type TopicPullLine = {
  topicId: string;
  title: string;
  kind: GoalKind | null;
  provider: ProviderId | null;
  outcome: PullOutcome;
  itemId: string | null;
  detail?: string;
};

export type LitTopicPorts = {
  /** Lit Level 4 topics. */
  litTopics: () => Promise<LitTopic[]>;
  /** Earlier attempts by topic, and how many were made today. */
  history: () => Promise<{ prior: Map<string, PriorPull>; today: number }>;
  classify: (goal: GoalToClassify) => Promise<{ ok: true; kind: GoalKind | null } | { ok: false; detail: string }>;
  /** Run one provider for the topic as a goal; null when it has no code. */
  pull: (provider: ProviderId, goal: GoalToClassify) => Promise<ProviderRun | null>;
  /** Record the attempt: it counts against the day's budget. */
  record: (line: TopicPullLine, day: string) => Promise<void>;
  /** The run has run out of time. */
  outOfTime: () => boolean;
};

export type LitTopicSummary = { lit: number; allowance: number; lines: TopicPullLine[] };

/** What a provider's run came to: stored if any document is now in the store for it. */
export function outcomeOfRun(run: ProviderRun): { outcome: PullOutcome; itemId: string | null; detail?: string } {
  if (!run.ok) return { outcome: 'failed', itemId: null, detail: run.detail };
  const stored = run.lines.find((l) => l.status === 'stored');
  if (stored && stored.status === 'stored') return { outcome: 'stored', itemId: stored.itemId };
  const failed = run.lines.find((l) => l.status === 'failed');
  if (failed && failed.status === 'failed') return { outcome: 'failed', itemId: null, detail: failed.detail };
  return { outcome: 'nothing', itemId: null };
}

export async function pullForLitTopics(ports: LitTopicPorts, now: Date): Promise<LitTopicSummary> {
  const day = dayOf(now);
  const [lit, history] = await Promise.all([ports.litTopics(), ports.history()]);
  const allowance = Math.max(0, PULLS_PER_DAY - history.today);
  const chosen = pickTopics({ lit, prior: history.prior, today: day, allowance });
  const lines: TopicPullLine[] = [];
  for (const topic of chosen) {
    if (ports.outOfTime()) break;
    const goal = goalOfTopic(topic);
    const base = { topicId: topic.id, title: topic.title };
    const classified = await ports.classify(goal);
    let line: TopicPullLine;
    if (!classified.ok) {
      // Recorded as failed, so it counts against the day and is tried again on a later one.
      line = { ...base, kind: null, provider: null, outcome: 'failed', itemId: null, detail: classified.detail };
    } else {
      const provider = firstWiredProvider(classified.kind);
      if (!provider) {
        line = { ...base, kind: classified.kind, provider: null, outcome: 'nothing', itemId: null };
      } else {
        try {
          const run = await ports.pull(provider, goal);
          const result = run ? outcomeOfRun(run) : { outcome: 'nothing' as const, itemId: null };
          line = { ...base, kind: classified.kind, provider, ...result };
        } catch (error) {
          line = {
            ...base,
            kind: classified.kind,
            provider,
            outcome: 'failed',
            itemId: null,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
    lines.push(line);
    await ports.record(line, day);
  }
  return { lit: lit.length, allowance, lines };
}
