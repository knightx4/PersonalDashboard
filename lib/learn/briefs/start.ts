import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import { collectSpend } from '@/lib/learn/spend';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { SubQuestion } from './model';
import { frameQuestion } from './research-model';
import { researchBrief, recordWithSession, type RecordSpend } from './research-run';

/**
 * What Ask Dash's research_topic needs to start a brief's research (plan
 * #2023.3): the first call, made before the reply so Dash can name the
 * sub-questions it chose, and the rest of the run, started once the reply has
 * gone.
 *
 * Ask runs it on the person's session, so spend is recorded through their
 * cookies and the run goes on in `after`. The connector runs it on the
 * service-role client and passes its own recorder and `later`.
 */
export type BriefStarter = {
  /** Three to five sub-questions, or null when the call failed or there is no key: the run frames them then. */
  frame: (question: string, angle: string) => Promise<SubQuestion[] | null>;
  /** Searches, reads and writes the brief after the reply. Never throws. */
  start: (briefId: string) => void;
};

export function briefStarter(options: {
  learn: LearnSupabaseClient;
  userId: string;
  recordSpend?: RecordSpend;
  later?: (work: () => Promise<void>) => void;
  apiKey?: string;
  client?: Anthropic;
}): BriefStarter {
  const record = options.recordSpend ?? recordWithSession;
  const later = options.later ?? ((work: () => Promise<void>) => after(work));
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  let client = options.client;
  const clientFor = () => (client ??= apiKey ? new Anthropic({ apiKey }) : undefined);

  return {
    async frame(question, angle) {
      const anthropic = clientFor();
      if (!anthropic) return null;
      const spend = collectSpend();
      try {
        const framed = await frameQuestion({ question, angle, client: anthropic, onSpend: spend.sink });
        if (!framed.ok) {
          console.error('[research_topic] framing', framed.detail);
          return null;
        }
        return framed.subQuestions;
      } catch (error) {
        console.error('[research_topic] framing', error instanceof Error ? error.message : error);
        return null;
      } finally {
        await record(options.userId, spend.reports);
      }
    },
    start(briefId) {
      const anthropic = clientFor();
      later(() =>
        researchBrief(options.learn, options.userId, briefId, {
          ...(anthropic ? { client: anthropic } : {}),
          recordSpend: record,
        }).then(() => undefined),
      );
    },
  };
}
