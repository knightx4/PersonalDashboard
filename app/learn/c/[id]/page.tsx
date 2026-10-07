import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadClaimMaterial } from '@/lib/learn/catalogue/material';
import { loadConceptView } from '@/lib/learn/graph/concept';
import { nextRung, probesFor } from '@/lib/learn/graph/session';
import { openingQuestionFor } from '@/lib/learn/graph/opening';
import { loadConceptNotes } from '@/lib/learn/notes/store';
import { ConceptPageView } from './concept-view';

export const dynamic = 'force-dynamic';

/**
 * One concept: the claim, where it stands, what it sits between, what has been
 * asked about it, and what there is to read about it.
 *
 * The subject page shows a claim inside a chain, which is the right frame for
 * deciding what to learn next and the wrong one for reading about a single
 * idea. This is the page a link can point at -- from a card, from another
 * claim that mentions this one, from a highlight somebody wants to branch off
 * -- and it computes nothing the subject page does not already compute.
 *
 * Four things on it write. Two ask first: taking a gap to the reading queue,
 * which is the same action and the same two ids as the card it came from, and
 * branching a chain off a phrase selected in the claim, which is proposed and
 * approved like any other goal. The third is rewriting the claim, which needs
 * no proposal because the words are yours -- what the app wrote is kept, and
 * the page says which of you wrote the sentence being read. The fourth is
 * queueing a piece of the catalogue's material for this claim, which needs no
 * approval screen either: the list it is pressed from is the proposal, which
 * is what #725 settled. The fifth is a note on the idea (plan #1058), which is
 * yours and asks nothing first; the notes written on its Learn now cards show
 * beside it.
 */

export default async function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await requireUser();
  const supabase = await createLearnClient();
  // Somebody else's concept reads as no row at all, so it lands here as a 404
  // rather than as a page saying whose it is.
  const [view, settings] = await Promise.all([
    loadConceptView(supabase, id),
    loadAccountSettings(user.id),
  ]);
  if (!view) notFound();

  const { concept, subject } = view;
  const probes = await probesFor(supabase, concept.id);

  const [opening, material, notes] = await Promise.all([
    // The question asked before any of this subject existed, when there was
    // one. It is where a state of known or shaky on a first chain came from,
    // so a page showing the state has to be able to show what established it.
    openingQuestionFor(supabase, subject.id, concept.name),
    // Which rung you are at is which rung the next question about this claim
    // would be asked at, and it is the largest term in the order material is
    // offered in: an article section lays an idea out, a lecture works an
    // example. `nextRung` is the module's own rule for that and reads the
    // answers already given, so this is a lookup rather than a second opinion.
    loadClaimMaterial(supabase, user.id, {
      conceptId: concept.id,
      rung: nextRung(concept.mastery, probes).rung,
      // When the button on this claim last got an answer out of the catalogue,
      // which is what separates "nothing matched" from "nobody has looked".
      searchedAt: concept.catalogueSearchedAt,
    }),
    // Your notes on this idea, from its cards and from this page (plan #1058).
    loadConceptNotes(supabase, concept.id),
  ]);

  return (
    <ConceptPageView
      view={view}
      probes={probes}
      opening={opening}
      material={material}
      notes={notes}
      timezone={settings.timezone}
      now={new Date()}
    />
  );
}
