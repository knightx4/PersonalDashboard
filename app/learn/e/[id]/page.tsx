import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { essayTitle } from '@/lib/learn/essays/model';
import { loadEssay } from '@/lib/learn/essays/store';
import { loadEssayNotes } from '@/lib/learn/essays/notes-store';
import { loadEssayResearch } from '@/lib/learn/essays/research-store';
import { EssayView } from './essay-view';
import { rowSubject } from '@/lib/core/subject';
import { toRef } from '@/lib/core/refs';

export const dynamic = 'force-dynamic';
/** Research on the essay frames, searches, reads and writes up in one press, which can take a couple of minutes. */
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function read(id: string) {
  if (!UUID.test(id)) return null;
  const supabase = await createLearnClient();
  return loadEssay(supabase, id);
}

/** The margin notes, found again in the draft as it now is (plan #1869). */
async function readNotes(id: string, doc: string) {
  const supabase = await createLearnClient();
  return loadEssayNotes(supabase, id, doc);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const essay = await read((await params).id);
  return { title: essay ? essayTitle(essay.draftBody, essay.path) : 'Essay' };
}

/** One essay in the editor; essay-view.tsx says how it is drawn (plan #1865). */
export default async function EssayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const essay = await read((await params).id);
  const asked = (await searchParams).view;
  const view = Array.isArray(asked) ? asked[0] : asked;
  if (!essay) notFound();
  const [notes, research] = await Promise.all([
    readNotes(essay.id, essay.draftBody),
    createLearnClient().then((supabase) => loadEssayResearch(supabase, essay.id)),
  ]);
  return (
    <EssayView
      essay={essay}
      notes={notes}
      research={research}
      initialView={view === 'notes' || view === 'draft' ? view : null}
      path={await rowSubject(toRef('learn.essays', essay.id))}
    />
  );
}
