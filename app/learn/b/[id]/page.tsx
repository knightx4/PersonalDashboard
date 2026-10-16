import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadBrief } from '@/lib/learn/briefs/load';
import { loadBriefGoalPanel } from '@/lib/learn/briefs/topics-store';
import { BriefView } from './brief-view';
import { rowSubject } from '@/lib/core/subject';
import { toRef } from '@/lib/core/refs';

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
  // The goal section (plan #2184.1). A failed read leaves it out rather than taking the page.
  const goal =
    page.brief.status === 'ready'
      ? await loadBriefGoalPanel(await createLearnClient(), page.brief.id).catch((error: unknown) => {
          console.error('[learn brief] goal panel', error instanceof Error ? error.message : error);
          return undefined;
        })
      : undefined;
  return <BriefView page={page} goal={goal} path={await rowSubject(toRef('learn.briefs', page.brief.id))} />;
}
