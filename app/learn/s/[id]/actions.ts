'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import {
  recordClaimSearched,
  searchCatalogueIfNew,
  searchCompleted,
} from '@/lib/learn/catalogue/search';
import { loadGoals, loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { ensureCurriculum, fileGoalUnder } from '@/lib/learn/graph/curriculum-store';
import { queueConcept } from '@/lib/learn/graph/to-queue';
import { recordLearnSpend } from '@/lib/learn/spend';
import { catalogueSql } from '@/lib/learn/catalogue/connection';
import { embedCatalogueSegments } from '@/lib/learn/catalogue/embed-sweep';
import { parseTitles, pullArticles, type PullReport } from '@/lib/learn/catalogue/pull';
import {
  DEFAULT_COURSE_PROVIDER,
  sweepWikipediaArticle,
  sweepYouTubeCourse,
} from '@/lib/learn/catalogue/sweep';
import { transcriptCutVideos } from '@/lib/learn/catalogue/store';
import {
  EMBED_BUDGET_MS,
  TRANSCRIPT_BUDGET_MS,
  parsePlaylistId,
  pullCourse,
  type CoursePullReport,
} from '@/lib/learn/catalogue/pull-course';

/**
 * Taking a gap to the reading queue, or to what has already been written about
 * it.
 *
 * The press #742 settled on. It looks through the catalogue first: the claim
 * is embedded, the segments nearest it are judged, and the ones argued for are
 * written as links. With at least one, this leaves you on the claim, where the
 * page lists what was found and queues nothing until you pick one -- the page
 * reads `catalogue_links` on every render, so there is nothing to hand it.
 * With none, it does what it always did and writes an ordinary reading in an
 * ordinary track, where Find sources already knows what to do with a subject
 * you wrote down and no source yet.
 *
 * Every way of the catalogue coming up empty lands in the same place. A
 * missing key, a provider that would not answer, forty candidates the judge
 * refused: the press was asking for something to read, and the web search is
 * what answers when the catalogue cannot. That is why the search reports a
 * miss rather than throwing.
 *
 * Pressed on a gap that is already in the queue it writes nothing and sends
 * you to the row that is there.
 *
 * Either way the claim records when it was last searched, so the page can tell
 * a claim nobody has looked for from one that was looked for and had nothing.
 * A press that never reached the catalogue records nothing, which leaves the
 * next press free to try again.
 *
 * **Pressed again with nothing new in the catalogue, it makes no call at all.**
 * #743's answer: the claim's search time is compared against the last time any
 * segment was embedded, and a press with nothing to judge shows what the last
 * one found. That press writes no search time and no spend, so the ledger
 * shows the judging calls of the press that did the work and nothing for the
 * press that repeated it.
 */
// latency: pending
export async function readAboutConcept(formData: FormData): Promise<void> {
  const user = await requireUser();

  const conceptId = z.string().uuid().safeParse(formData.get('conceptId'));
  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!conceptId.success || !subjectId.success) redirect('/learn/know');

  const supabase = await createLearnClient();
  const [subject, graph] = await Promise.all([
    loadSubject(supabase, subjectId.data),
    loadGraph(supabase, subjectId.data),
  ]);

  const concept = graph.concepts.find((c) => c.id === conceptId.data);
  if (!subject || !concept) redirect(`/learn/s/${subjectId.data}`);

  // Taken before the search rather than after it. The time written below is
  // what the next press compares against, so a segment embedded while this
  // search was running has to read as newer than this press: stamping the
  // finish would put that segment behind a search that never saw it, and no
  // later press would look at it again.
  const pressedAt = new Date();

  const found = await searchCatalogueIfNew(
    supabase,
    user.id,
    {
      claim: concept.claim,
      concept: concept.name,
      target: { concept: concept.id },
      pressedAt,
    },
    { searchedAt: concept.catalogueSearchedAt },
  );

  // Two operations rather than one, because the embedding is cents and the
  // judging is the cost that grows with the catalogue, and a screen that
  // groups by operation should be able to see them apart. Written after the
  // work rather than between the calls, so nothing the person is waiting on
  // waits on the ledger.
  await recordLearnSpend(user.id, 'embed-claim', found.embedSpend);
  await recordLearnSpend(user.id, 'judge-segment', found.judgeSpend);

  // A catalogue with nothing close and a judge that refused everything are the
  // ordinary misses and say nothing. The rest -- no key, a provider that would
  // not answer, a write that failed -- look identical from the page, which is
  // the point, and would otherwise leave nobody able to tell a catalogue that
  // covers nothing from a search that never ran.
  if (!found.skipped && !searchCompleted(found.missed)) {
    console.warn(`[learn catalogue] search missed (${found.missed})`, found.detail);
  }

  // The claim carries when it was last looked for, which is what lets the page
  // tell a claim nobody has searched from one that was searched and had
  // nothing. Written here rather than anywhere below, because the branch under
  // this one redirects and nothing after it runs.
  //
  // Only a press that got an answer out of the catalogue writes it. A press
  // that embedded nothing read nothing, and a claim saying it was searched
  // when nothing looked is a page inventing a search.
  //
  // A press that skipped wrote nothing and read nothing new, so it leaves both
  // alone: the links are the ones the last search wrote and the time is the
  // time that search ran, which is what the next press has to compare against.
  if (!found.skipped && searchCompleted(found.missed)) {
    await recordClaimSearched(supabase, user.id, concept.id, pressedAt);
    // Both of the things a completed press changes on the claim page are here:
    // the links it wrote and the time it looked. A press that found nothing
    // still changed what that page says about why, so this is not the covered
    // branch's job any more.
    revalidatePath(`/learn/c/${concept.id}`);
  }

  if (found.covered) {
    redirect(`/learn/c/${concept.id}`);
  }

  const readingId = await queueConcept(supabase, user.id, {
    subjectName: subject.name,
    concept,
  });

  revalidatePath('/learn/lists');
  // Straight to the reading -- the one just queued, or the one that was
  // already there -- where Find sources already knows what to do with a
  // subject you wrote down and no source yet.
  redirect(`/learn/r/${readingId}`);
}

export type PullState = { report?: PullReport; error?: string };

/**
 * Fetching named Wikipedia articles into the catalogue, and embedding them.
 *
 * What `npm run catalogue -- "…" --embed` does, from a subject page, so the
 * deployed app can fill the catalogue with the keys it already holds. The
 * articles are stored first and embedded after, in the same press, and the
 * embedding spend goes on the ledger of the account that pressed, as #741
 * settled.
 *
 * Both passes run inside the action rather than in after(), because a Voyage
 * refusal or a missing key has to be shown on the page, and after() runs once
 * the response has gone. The page sets maxDuration so twenty articles fit.
 *
 * The embedding pass is not limited to the articles this press fetched: it
 * gives a vector to every segment in the catalogue that has none, the same as
 * the script. Anything an earlier run left unembedded is finished here too,
 * and billed to this account.
 *
 * Pulling an article that is already in the catalogue updates its sections in
 * place. A section whose text is unchanged keeps its vector and the judgements
 * made against it. A section whose text changed loses its vector and is
 * embedded again, and a section the article no longer has is deleted along
 * with its judgements.
 */
// latency: pending
export async function pullWikipediaArticles(
  _previous: PullState,
  formData: FormData,
): Promise<PullState> {
  const user = await requireUser();

  const parsed = parseTitles(String(formData.get('titles') ?? ''));
  if (!parsed.ok) return { error: parsed.error };

  let sql;
  try {
    sql = catalogueSql();
  } catch (error) {
    return {
      error: `The catalogue cannot be written from this deployment: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const report = await pullArticles(
    {
      sweep: (title) => sweepWikipediaArticle(sql, title),
      embed: (limit) => embedCatalogueSegments(sql, { userId: user.id, limit }),
    },
    parsed.titles,
  );

  return { report };
}

export type CoursePullState = { report?: CoursePullReport; error?: string };

/**
 * Fetching a lecture course from its YouTube playlist into the catalogue, and
 * embedding it.
 *
 * What `npm run catalogue -- --course <playlist> --embed` does, from a subject
 * page, as #789 settled. The course goes under MIT OpenCourseWare, so each
 * lecture's transcript comes from ocw.mit.edu, and the embedding is billed to
 * the account that pressed, as #741 settled.
 *
 * One press has 300 seconds. Past TRANSCRIPT_BUDGET_MS it stops looking up
 * transcripts and stores the remaining lectures with their chapter or
 * whole-video cut, so the course is always stored whole and in order. Past
 * EMBED_BUDGET_MS it stops embedding. The report says how far it got, and a
 * second press finishes: lectures already cut from a transcript are left as
 * they are, so it spends its time on the ones the first press did not reach,
 * and the embedding pass picks up whatever has no vector yet.
 *
 * Pressing again on the same playlist updates the rows in place, keyed on the
 * playlist and video ids, so it never adds a second course or lecture.
 */
// latency: pending
export async function pullLectureCourse(
  _previous: CoursePullState,
  formData: FormData,
): Promise<CoursePullState> {
  const user = await requireUser();
  const startedAt = Date.now();

  const parsed = parsePlaylistId(String(formData.get('playlist') ?? ''));
  if (!parsed.ok) return { error: parsed.error };

  let sql;
  try {
    sql = catalogueSql();
  } catch (error) {
    return {
      error: `The catalogue cannot be written from this deployment: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const report = await pullCourse({
    sweep: () =>
      sweepYouTubeCourse(sql, {
        providerSlug: DEFAULT_COURSE_PROVIDER,
        playlistId: parsed.playlistId,
        keep: (videoIds) => transcriptCutVideos(sql, DEFAULT_COURSE_PROVIDER, videoIds),
        deadline: startedAt + TRANSCRIPT_BUDGET_MS,
      }),
    embed: (limit) =>
      embedCatalogueSegments(sql, {
        userId: user.id,
        limit,
        deadline: startedAt + EMBED_BUDGET_MS,
      }),
  });

  return { report };
}

/**
 * Delete a whole track: its curriculum, its ideas, their states and the
 * questions asked on them, all on the foreign keys' cascades. Readings that
 * pointed at one of its ideas stay on their reading lists with the link
 * cleared, and a Learn now card that started it keeps its row.
 *
 * Throws rather than returning an error, because ConfirmStep renders what a
 * rejected promise says.
 */
// latency: pending
export async function deleteSubject(formData: FormData): Promise<void> {
  await requireUser();
  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!subjectId.success) throw new Error('Could not work out which track to delete.');

  const supabase = await createLearnClient();
  const { data, error } = await supabase.from('subjects').delete().eq('id', subjectId.data).select('id');
  if (error) throw new Error(`Deleting the track failed: ${error.message}`);
  if ((data ?? []).length === 0) throw new Error('That track is already gone.');

  revalidatePath('/learn/know');
  revalidatePath('/learn/flow');
  redirect('/learn/know');
}

export type CurriculumState = { error?: string };

/**
 * Write the curriculum for a track that has none: one made before tracks had
 * them, one started from a Learn now card or a briefing, or one whose first
 * attempt failed. A track that already has one keeps it.
 */
// latency: pending
export async function writeTrackCurriculum(_prev: CurriculumState, formData: FormData): Promise<CurriculumState> {
  const user = await requireUser();
  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!subjectId.success) return { error: 'Could not work out which track this was.' };

  const supabase = await createLearnClient();
  const [subject, goals] = await Promise.all([
    loadSubject(supabase, subjectId.data),
    loadGoals(supabase, subjectId.data),
  ]);
  if (!subject) return { error: 'That track is gone.' };

  // The oldest goal is what the track was started for.
  const first = goals.at(-1) ?? null;
  const result = await ensureCurriculum(
    supabase,
    user.id,
    { id: subject.id, name: subject.name },
    first?.asked ?? subject.note ?? null,
  );
  if (!result.ok) return { error: result.detail };
  if (result.goalUnitId && first && !first.unitId) await fileGoalUnder(supabase, first.id, result.goalUnitId);

  revalidatePath(`/learn/s/${subject.id}`);
  return {};
}
