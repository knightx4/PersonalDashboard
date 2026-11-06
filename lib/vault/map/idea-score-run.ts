import type { SpendReport } from '@/lib/core/spend/pricing';
import type { JevFailure } from '@/lib/jev/client';
import {
  IDEA_SCORE_RUBRIC_VERSION,
  ideaScoreState,
  type IdeaScore,
  type IdeaScoreResult,
  type IdeaToScore,
} from './idea-score';
import type { VaultRules } from './rules';

/**
 * Scoring every idea on one person's map with Jev, and each new or changed
 * one after (plan #2947.3). The database and Jev are behind ports, filled in
 * by inngest/vault/idea-scores.ts, so the loop is tested without either.
 *
 * Each batch asks obsidian.idea_score_due for up to IDEA_SCORE_BATCH ideas:
 * those with no score, a score under an older rubric, or source notes that
 * changed since the last check. For each, the exact input hash is worked out
 * from the idea and its notes' text; an idea whose hash and rubric match its
 * stored row only has its signature brought up to date, and every other one
 * is asked of Jev and saved. A run ends at its deadline or when nothing is
 * due, and the next one starts from whatever is still due, so a backfill
 * resumes where it stopped.
 *
 * A Jev failure on one idea leaves it unscored for the next run; there is no
 * Haiku fallback. Jev asking for a pause (rate-limited, overloaded) is waited
 * out with a growing pause, up to RATE_LIMIT_RETRIES times, and then ends the
 * run. A missing or refused key ends it at once, since no idea would fare
 * better.
 */

/** Ideas fetched and worked per batch. */
export const IDEA_SCORE_BATCH = 50;

/** The pause after Jev's first rate-limited or overloaded answer, doubled on each one after. */
export const RATE_LIMIT_PAUSE_MS = 5_000;

/** How many pauses one idea may wait out before the run stops for the next tick. */
export const RATE_LIMIT_RETRIES = 3;

/** The short pause between batches, so a backfill does not run into the limit in the first place. */
export const BATCH_PAUSE_MS = 1_000;

export type DueIdea = {
  positionId: string;
  /** obsidian.idea_score_due's signature, stored with the row once it is checked. */
  sourceSig: string;
};

export type LoadedIdea = {
  idea: IdeaToScore;
  /** The stored row's hash and rubric, or null when it has none. */
  stored: { inputHash: string; rubricVersion: string } | null;
};

export type IdeaScorePorts = {
  due(limit: number): Promise<DueIdea[]>;
  /** The ideas and their sources, each note with its body. A position gone since `due` is left out. */
  load(positionIds: string[]): Promise<Map<string, LoadedIdea>>;
  score(idea: IdeaToScore, onSpend: (report: SpendReport) => void): Promise<IdeaScoreResult>;
  save(positionId: string, score: IdeaScore, sourceSig: string): Promise<void>;
  /** The idea reads the same as when it was scored: store the new signature only. */
  touch(positionId: string, sourceSig: string): Promise<void>;
  /** What the batch's Jev calls cost, recorded against the person. */
  ledger(reports: SpendReport[]): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
};

export type IdeaScoreStop = { reason: 'time' | JevFailure['reason']; detail: string };

export type IdeaScoreRunResult = {
  scored: number;
  /** Ideas whose notes changed but not in what Jev reads. */
  unchanged: number;
  /** Ideas Jev could not answer for this run, left for the next. */
  failed: number;
  /** True when nothing was left due when the run ended. */
  caughtUp: boolean;
  stopped: IdeaScoreStop | null;
};

export async function runIdeaScores(opts: {
  ports: IdeaScorePorts;
  rules: VaultRules;
  deadline: number;
}): Promise<IdeaScoreRunResult> {
  const { ports, rules, deadline } = opts;
  const result: IdeaScoreRunResult = { scored: 0, unchanged: 0, failed: 0, caughtUp: false, stopped: null };
  // An idea that failed this run stays due; it is skipped until the next one.
  const failed = new Set<string>();
  let first = true;

  while (result.stopped === null) {
    if (ports.now() >= deadline) {
      result.stopped = { reason: 'time', detail: 'The run reached its deadline.' };
      break;
    }
    if (!first) await ports.sleep(BATCH_PAUSE_MS);
    first = false;

    const due = (await ports.due(IDEA_SCORE_BATCH + failed.size)).filter((d) => !failed.has(d.positionId));
    if (due.length === 0) {
      result.caughtUp = failed.size === 0;
      break;
    }
    const batch = due.slice(0, IDEA_SCORE_BATCH);
    const loaded = await ports.load(batch.map((d) => d.positionId));
    const spend: SpendReport[] = [];

    try {
      for (const item of batch) {
        if (ports.now() >= deadline) {
          result.stopped = { reason: 'time', detail: 'The run reached its deadline.' };
          break;
        }
        const entry = loaded.get(item.positionId);
        // Gone since it was listed (merged away or deleted): nothing to score.
        if (!entry) {
          failed.add(item.positionId);
          continue;
        }
        const { inputHash } = ideaScoreState(entry.idea, rules);
        if (entry.stored?.inputHash === inputHash && entry.stored.rubricVersion === IDEA_SCORE_RUBRIC_VERSION) {
          await ports.touch(item.positionId, item.sourceSig);
          result.unchanged += 1;
          continue;
        }

        const answer = await scoreWithPauses(ports, entry.idea, (report) => spend.push(report));
        if (answer.ok) {
          await ports.save(item.positionId, answer.score, item.sourceSig);
          result.scored += 1;
          continue;
        }
        failed.add(item.positionId);
        result.failed += 1;
        if (endsTheRun(answer.reason)) {
          result.stopped = { reason: answer.reason, detail: answer.detail };
          break;
        }
      }
    } finally {
      if (spend.length > 0) await ports.ledger(spend);
    }
  }
  return result;
}

/** Failures no other idea would avoid: the run stops rather than ask again. */
function endsTheRun(reason: JevFailure['reason']): boolean {
  return reason === 'no-key' || reason === 'refused' || reason === 'rate-limited' || reason === 'overloaded';
}

async function scoreWithPauses(
  ports: IdeaScorePorts,
  idea: IdeaToScore,
  onSpend: (report: SpendReport) => void,
): Promise<IdeaScoreResult> {
  let answer = await ports.score(idea, onSpend);
  for (let retry = 0; retry < RATE_LIMIT_RETRIES; retry++) {
    if (answer.ok || (answer.reason !== 'rate-limited' && answer.reason !== 'overloaded')) return answer;
    await ports.sleep(RATE_LIMIT_PAUSE_MS * 2 ** retry);
    answer = await ports.score(idea, onSpend);
  }
  return answer;
}
