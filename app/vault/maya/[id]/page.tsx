import { notFound } from 'next/navigation';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadNoteLinks, loadThread } from '@/lib/vault/maya/store';
import { MayaThreadView } from './thread-view';

export const dynamic = 'force-dynamic';

/**
 * One thread with Maya (plan #1286): the question it is about, where you have
 * got to, Maya's ranked points with the notes and works each draws on, and
 * the replies either way with the box to add one.
 *
 * Every link to a thread comes through mayaThreadHref in lib/vault/paths.ts.
 * A thread can exist without its thought (the thought's insert failed after
 * the thread's), and then the page says so and the thread can still be
 * answered: Maya replies from the note.
 */
export default async function MayaThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vault = await createVaultClient();
  const thread = await loadThread({ core: await createCoreClient(), vault }, id);
  if (!thread) notFound();

  const thought = thread.messages.find((message) => message.kind === 'thought')?.thought ?? null;
  const cited = await loadNoteLinks(
    vault,
    (thought?.points ?? []).flatMap((point) => point.notes.map((note) => note.noteId)),
  );

  return <MayaThreadView thread={thread} cited={cited} />;
}
