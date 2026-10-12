import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { essayTitle } from '@/lib/learn/essays/model';
import { loadEssay } from '@/lib/learn/essays/store';
import { EssayView } from './essay-view';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function read(id: string) {
  if (!UUID.test(id)) return null;
  const supabase = await createLearnClient();
  return loadEssay(supabase, id);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const essay = await read((await params).id);
  return { title: essay ? essayTitle(essay.draftBody, essay.path) : 'Essay' };
}

/** One essay in the editor; essay-view.tsx says how it is drawn (plan #1865). */
export default async function EssayPage({ params }: { params: Promise<{ id: string }> }) {
  const essay = await read((await params).id);
  if (!essay) notFound();
  return <EssayView essay={essay} />;
}
