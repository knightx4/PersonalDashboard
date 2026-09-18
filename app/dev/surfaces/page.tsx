import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadFeedbackQueue } from '@/lib/feedback/load';
import { SURFACES } from '@/app/preview/surfaces';
import { surfaceOf } from '@/lib/feedback/surfaces';
import { SurfaceReview } from './review';

export const metadata = { title: 'Surfaces' };

/**
 * Every surface in the app, rendered live, with somewhere to say what is wrong
 * with it.
 *
 * The loop this closes: five sweeps and a polish pass all ran on evidence the
 * person who owns the app never saw. He looked at his phone, said "this is
 * still clunky", and was right every time -- but the only way that reached the
 * work was a photograph pasted into a chat, one screen at a time. Everything
 * else was me deciding what looked wrong, which is the one judgement I am
 * least qualified to make alone.
 *
 * So: the surfaces are here, at the width they are read at, and a note written
 * under one lands in the same `feedback_items` queue as every other note, with
 * the surface in `page_path`. Nothing new to check, no second inbox --
 * `npx tsx scripts/notes.ts list` shows them beside the bug reports, and the
 * notes skill already knows how to work that queue and close each one with a
 * reason.
 *
 * `page_path` rather than a new column on purpose. Its comment in the
 * migration reads "where the user was standing when they hit the problem", and
 * `/preview?s=jobs-pipeline-dense` is precisely that. A `surface` column would
 * have been a second name for one idea.
 */
export default async function DevSurfacesPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const queue = await loadFeedbackQueue(supabase, user.id);

  /** Notes filed against a surface, by surface id. */
  const notesBySurface = new Map<string, typeof queue.rows>();
  for (const row of queue.rows) {
    const surface = surfaceOf(row.pagePath);
    if (!surface) continue;
    notesBySurface.set(surface, [...(notesBySurface.get(surface) ?? []), row]);
  }

  const surfaces = SURFACES.map((surface) => ({
    id: surface.id,
    label: surface.label,
    module: surface.module,
    notes: (notesBySurface.get(surface.id) ?? []).map((note) => ({
      id: note.id,
      body: note.body,
      status: note.status,
      resolutionNote: note.resolutionNote,
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Surfaces"
        description="The real components, at the width they are read at. Say what is wrong under one and it joins the notes queue."
      />
      <SurfaceReview surfaces={surfaces} />
    </div>
  );
}
