import { CellAnswer } from '@/components/learn/cell-answer';
import { NoTopicToPlace, PracticeError } from '@/components/learn/practice-states';
import { RunSummaryView } from '@/components/learn/run-summary-view';
import { EmptyState } from '@/components/ui/empty-state';
import { createLearnClient } from '@/lib/learn/auth/server';
import { practiceHref } from '@/lib/learn/flow/href';
import { askCell } from '@/lib/learn/levels/answer-store';
import type { GradeMap } from '@/lib/learn/levels/grade';
import { loadGradeMap } from '@/lib/learn/levels/loader-grade';
import { pickCell, whyLine } from '@/lib/learn/levels/pick';
import { countAnswered, loadLensScope, loadRunDoubts, type LensScope } from '@/lib/learn/levels/practice-store';
import { runSummary } from '@/lib/learn/levels/run';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Practice Flow asking about levels of topics (plan #2138.6;
 * docs/LEARN-LEVELS-SPEC.md, "Choosing the next question"). Each visit picks
 * one level (lib/learn/levels/pick.ts): placement on a topic not yet placed,
 * then the fringe with misses first, with a re-check one answer in five. The
 * answer screen lists every level the answer reached.
 *
 * A run is the questions since `run`, a time the links carry from one
 * question to the next. End run, or running out of questions, shows what
 * moved in it (lib/learn/levels/run.ts). Nothing about the run is stored.
 */

/** A time the flow wrote itself; anything else starts a new run. */
function runTime(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) || t > Date.now() ? null : new Date(t).toISOString();
}

async function summary(
  learn: Awaited<ReturnType<typeof createLearnClient>>,
  userId: string,
  map: GradeMap,
  since: string,
) {
  const [answered, doubted] = await Promise.all([
    countAnswered(learn, userId, since),
    loadRunDoubts(learn, userId, since, map),
  ]);
  return runSummary({ map, since, answered, doubted });
}

export async function LevelsFlow({
  userId,
  subject,
  only,
  run: runParam,
  end: endParam,
}: {
  userId: string;
  /** The subject the flow is focused on, whose lens bounds the topics. */
  subject: { id: string; name: string } | null;
  only: string | null;
  run?: string | string[];
  end?: string | string[];
}) {
  const scopeHref = { track: subject?.id ?? null, only };
  const learn = await createLearnClient();
  const now = new Date();

  let map: GradeMap;
  let lens: LensScope;
  try {
    [map, lens] = await Promise.all([loadGradeMap(learn, userId), loadLensScope(learn, userId, subject?.id ?? null)]);
  } catch (error) {
    return (
      <PracticeError
        message={error instanceof Error ? error.message : 'Reading your topics failed.'}
        retryHref={practiceHref(scopeHref)}
      />
    );
  }

  const end = runTime(endParam);
  if (end) {
    const ended = await summary(learn, userId, map, end).then(
      (s) => ({ ok: true as const, s }),
      (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : 'Reading this run failed.' }),
    );
    return ended.ok ? (
      <RunSummaryView summary={ended.s} againHref={practiceHref(scopeHref)} />
    ) : (
      <PracticeError message={ended.message} retryHref={practiceHref({ ...scopeHref, end })} />
    );
  }

  const inScope = map.topics.filter((t) => t.approved && (!lens.topics || lens.topics.has(t.id)));
  if (inScope.length === 0) return <NoTopicToPlace subjectName={subject?.name} />;

  const run = runTime(runParam);
  let answered: number;
  try {
    answered = await countAnswered(learn, userId);
  } catch (error) {
    return (
      <PracticeError
        message={error instanceof Error ? error.message : 'Counting your answers failed.'}
        retryHref={practiceHref({ ...scopeHref, run })}
      />
    );
  }
  const picked = pickCell(map, {
    now,
    answered,
    lensTargets: lens.targets,
    topics: lens.topics ?? undefined,
  });

  if (!picked) {
    if (run) {
      const ended = await summary(learn, userId, map, run).catch(() => null);
      if (ended) return <RunSummaryView summary={ended} againHref={practiceHref(scopeHref)} nothingLeft />;
    }
    return (
      <EmptyState
        title={subject ? `Nothing left to ask about ${subject.name}` : 'Nothing left to ask'}
        description="Every level you are ready for has been asked about recently. Levels you missed come back after a rest, and held ones are checked again after a month."
        tone="finished"
        seed={`${userId}:${now.toISOString().slice(0, 10)}:learn-levels`}
      />
    );
  }

  const runStart = run ?? now.toISOString();
  const spend = collectSpend();
  const asked = await askCell(
    learn,
    userId,
    picked.cellId,
    process.env.ANTHROPIC_API_KEY ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY, onSpend: spend.sink } : undefined,
  );
  await recordLearnSpend(userId, 'write-cell-case', spend.reports);
  if (!asked.ok) return <PracticeError message={asked.error} retryHref={practiceHref({ ...scopeHref, run: runStart })} />;

  return (
    <CellAnswer
      key={asked.asked.questionId}
      asked={{ ...asked.asked, why: whyLine(picked, now) }}
      nextHref={practiceHref({ ...scopeHref, run: runStart, after: asked.asked.questionId })}
      endHref={practiceHref({ ...scopeHref, end: runStart })}
    />
  );
}
