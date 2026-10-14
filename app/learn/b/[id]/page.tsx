import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadBrief } from '@/lib/learn/briefs/load';
import { BriefView } from './brief-view';

export const dynamic = 'force-dynamic';
// Try again runs the research after its response (actions.ts#retryBrief):
// three calls and up to ten searches, a few minutes.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function read(id: string) {
  if (!UUID.test(id)) return null;
  const supabase = await createLearnClient();
  return loadBrief(supabase, id);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const page = await read((await params).id);
  return { title: page ? page.brief.question : 'Research' };
}

/** One researched topic; brief-view.tsx says how it is drawn (plan #2023.4). */
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await read((await params).id);
  if (!page) notFound();
  return <BriefView page={page} />;
}
