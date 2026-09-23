import Link from 'next/link';
import { Network } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionFold } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadAreaGrid, type LoadedAreaGrid } from '@/lib/learn/areas/grid-load';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGraph, loadSubjects } from '@/lib/learn/graph/load';
import { outstandingCount, unfinishedSweep } from '@/lib/learn/graph/opening';
import { countStates, settledCount } from '@/lib/learn/graph/model';
import { MAX_BRIEFING_CHARS } from '@/lib/learn/graph/from-brief';
import { BriefForm } from './brief-form';
import { FromVaultForm } from './from-vault-form';
import { AreasGrid, type OpenedThemes } from './areas-grid';
import { destinationsFor, openedPlace, runnerUpOf, targetValue } from '@/lib/learn/areas/move';
import { loadPlacedThemes } from '@/lib/learn/areas/themes-load';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadNotes } from '@/lib/vault/notes/load';

/** How many notes the picker offers. Scaffolding; the sweep needs no picker. */
const VAULT_PICKER_LIMIT = 500;
import { GoalForm } from './goal-form';
import { PriorForm } from './prior-form';

export const dynamic = 'force-dynamic';

/**
 * What you know, by subject.
 *
 * The other half of the module. The queue answers "where do I read this"; this
 * answers "what do I actually know, what am I missing, and what is the one
 * next thing worth learning".
 *
 * A subject is the container and it lives forever, so this list is short and
 * grows slowly -- one row per field you have ever worked on, not one per
 * thing you asked. Read-only for now: nothing here creates a subject, because
 * the slice this belongs to exists to prove the view over a graph put there by
 * hand before anything generates into it.
 */

function settledLine(counts: ReturnType<typeof countStates>): string {
  if (counts.total === 0) return 'No concepts yet.';

  const parts = [`${settledCount(counts)} of ${counts.total} known`];
  const gettingThere = counts.recognised + counts.shaky;
  if (gettingThere > 0) parts.push(`${gettingThere} getting there`);
  // Named first-class, because a thing steering you wrong is not a gap and
  // should not be counted as one.
  if (counts.misconception > 0) parts.push(`${counts.misconception} mixed up`);
  return parts.join(' · ');
}

export default async function KnowPage({
  searchParams,
}: {
  searchParams: Promise<{ field?: string; domain?: string; unplaced?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const supabase = await createLearnClient();
  const vault = await createVaultClient();
  const subjects = await loadSubjects(supabase);
  const unfinished = await unfinishedSweep(supabase);
  const settings = await loadAccountSettings(user.id);

  // Scaffolding for the first slice of the vault pass: a list to pick one note
  // out of. The sweep that follows picks its own and needs no list, so this is
  // capped rather than paged.
  const vaultNotes = (await loadNotes(vault, { limit: VAULT_PICKER_LIMIT })).map((note) => ({
    path: note.path,
    title: note.title,
  }));

  const graphs = await Promise.all(
    subjects.map(async (subject) => ({ subject, graph: await loadGraph(supabase, subject.id) })),
  );
  const rows = graphs.map(({ subject, graph }) => ({ subject, counts: countStates(graph) }));

  // The grid failing must not take the tracks list and the forms with it, so
  // a failed read becomes one line where the grid would be (law 2).
  let areas: LoadedAreaGrid | null = null;
  try {
    areas = await loadAreaGrid(supabase, vault, graphs);
  } catch {
    areas = null;
  }

  // The place the URL opens, with the reasons behind each theme in it. Read
  // for this one place only; a failed read is said inside the panel.
  let opened: OpenedThemes | null = null;
  const place = areas ? openedPlace(params, areas.grid) : null;
  if (areas && place) {
    const grid = areas.grid;
    let themes: OpenedThemes['themes'] = null;
    try {
      themes = (await loadPlacedThemes(supabase, vault, place.target)).map((theme) => ({
        placementId: theme.placementId,
        name: theme.name,
        basis: theme.basis,
        runnerUp: runnerUpOf(theme, grid),
        movedByHand: theme.movedByHand,
        at: targetValue(theme.target),
      }));
    } catch {
      themes = null;
    }
    opened = { place, themes, groups: destinationsFor(grid) };
  }

  return (
    <>
      <PageHeader
        title="Tracks"
        description="One graph per track, and it grows every time you use it."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No tracks yet"
          description="A track is the container: Economics, not the Phillips curve. Name a goal below and the chain of things leading to it gets laid out, in whichever track it belongs to."
        />
      ) : (
        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {rows.map(({ subject, counts }) => (
            <li key={subject.id}>
              <Link
                href={`/learn/s/${subject.id}`}
                className="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-sunken"
              >
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">{subject.name}</span>
                  {subject.note && (
                    <span className="block truncate text-ui text-ink-muted">{subject.note}</span>
                  )}
                </span>
                <span className="shrink-0 text-ui text-ink-muted">{settledLine(counts)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {areas ? (
        <AreasGrid
          grid={areas.grid}
          interestFailed={areas.interestFailed}
          timezone={settings.timezone}
          opened={opened}
        />
      ) : (
        <p className="mt-8 text-ui text-ink-muted">
          The fields could not be read, so the grid is missing.
        </p>
      )}

      {/* The way back into a set of opening questions somebody walked away
          from. Without it the only route back is a URL on a tab that is
          already closed. */}
      {unfinished && (
        <Link
          href={`/learn/opening/${unfinished.id}`}
          className={cn(cardVariants({ padding: 'standard', interactive: true }), 'mt-6 block')}
        >
          <span className="block text-body font-medium text-ink">
            Finish the questions on {unfinished.subjectName}
          </span>
          <span className="block text-ui text-ink-muted">
            {outstandingCount(unfinished)} of {unfinished.questions.length} left, then the chain for
            “{unfinished.asked}” gets laid out.
          </span>
        </Link>
      )}

      {/* Naming a goal is how a subject comes into being, so the form is here
          rather than behind a button: with no subjects yet, it is the only
          thing on the page worth doing. */}
      <GoalForm />

      {/* And the other direction. A goal says what you are missing; this says
          what you already have, which is the only thing on this page that can
          reach what you learned before any of this existed. Second because it
          is the rarer move -- written once for a field, not once a week. */}
      {/* Each of the three ways in below folds shut under its own heading
          (note f877038d). They are the rarer moves, and open they were three
          large fields stacked under the goal form. */}
      <SectionFold title="Or start from what you already know" defaultOpen={false} className="mt-8">
        <PriorForm />
      </SectionFold>

      {/* And the third way in, the only one that starts from a document
          somebody else wrote. Last because it is the rarest: a prepared
          briefing arrives when you are about to be examined on something, not
          on an ordinary week. */}
      <SectionFold title="Or import a briefing you were handed" defaultOpen={false} className="mt-4">
        <BriefForm
          subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
          maxChars={MAX_BRIEFING_CHARS}
        />
      </SectionFold>

      {/* The fourth way in, and the one that needs nothing typed. The vault
          already holds years of notes arguing things; this reads one of them.
          Last because it is the first slice of a sweep that will eventually
          read all of them without being asked, at which point this form is
          for checking what the sweep would do rather than for doing it. */}
      <SectionFold title="Or read a note from your vault" defaultOpen={false} className="mt-4">
        <FromVaultForm
          subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
          notes={vaultNotes}
        />
      </SectionFold>
    </>
  );
}
