import { notFound } from 'next/navigation';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadSweep } from '@/lib/learn/graph/opening';
import { OpeningView } from './opening-view';
import { rowSubject } from '@/lib/core/subject';
import { toRef } from '@/lib/core/refs';

export const dynamic = 'force-dynamic';

/** The questions asked before anything is laid out; opening-view.tsx draws them. */
export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const sweep = await loadSweep(supabase, id);
  if (!sweep) notFound();

  return <OpeningView sweep={sweep} path={await rowSubject(toRef('learn.opening_sweeps', id))} />;
}
