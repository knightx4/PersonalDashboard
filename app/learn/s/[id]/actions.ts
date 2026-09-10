'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { queueConcept } from '@/lib/learn/graph/to-queue';

/**
 * Taking a gap to the reading queue.
 *
 * The one action on this page that writes, and it writes an ordinary reading
 * in an ordinary track -- the queue is the same queue, and everything it
 * already does works on the row because the row is not special.
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

  const readingId = await queueConcept(supabase, user.id, {
    subjectName: subject.name,
    concept,
  });

  revalidatePath('/learn');
  // Straight to the reading, where Find sources already knows what to do with
  // a subject you wrote down and no source yet.
  redirect(`/learn/r/${readingId}`);
}
