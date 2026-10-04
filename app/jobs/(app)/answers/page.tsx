import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { AnswersView, KINDS, type AnswerRow } from './answers-view';

export const metadata = { title: 'Answers' };

/**
 * The question bank.
 *
 * The reuse loop is the whole point: after twenty applications the common
 * questions are answered and the work per application drops to tailoring.
 * Generation is later work, but capture and manual answering are MVP precisely so
 * the bank has real content by the time generation exists.
 */
export default async function AnswersPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const kind = KINDS.find((k) => k === params.kind);

  const { data: questions } = await supabase
    .from('questions')
    .select(
      'id, text, kind, canonical_answer, canonical_answer_updated_at, times_seen, application_answers ( id, answer, status, application_id )',
    )
    .eq('user_id', user.id)
    .order('times_seen', { ascending: false });

  const rows = (questions ?? []) as unknown as AnswerRow[];

  return <AnswersView rows={rows} kind={kind} />;
}
