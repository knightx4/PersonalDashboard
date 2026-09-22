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
import { loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { queueConcept } from '@/lib/learn/graph/to-queue';
import { recordLearnSpend } from '@/lib/learn/spend';

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

  revalidatePath('/learn');
  // Straight to the reading -- the one just queued, or the one that was
  // already there -- where Find sources already knows what to do with a
  // subject you wrote down and no source yet.
  redirect(`/learn/r/${readingId}`);
}
