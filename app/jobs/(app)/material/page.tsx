import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { MATERIAL_PARTS, QUESTION_KINDS, type MaterialPart } from '@/lib/jobs/material';
import { MaterialView } from './material-view';

export const metadata = { title: 'Material' };

/**
 * Material: the question bank, the evidence bank, the resume versions and the
 * writing voice, which used to be split between Answers and the bottom of
 * Settings (plan #1592). Everything a draft draws on, so it sits together.
 */
export default async function MaterialPage({
  searchParams,
}: {
  searchParams: Promise<{ part?: string; kind?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const part: MaterialPart = MATERIAL_PARTS.find((p) => p.id === params.part)?.id ?? 'answers';
  const kind = QUESTION_KINDS.find((k) => k === params.kind) ?? null;

  const [{ data: questions }, { data: evidence }, { data: resumes }, { data: profile }] =
    await Promise.all([
      supabase
        .from('questions')
        .select(
          'id, text, kind, canonical_answer, times_seen, application_answers ( id, answer, status )',
        )
        .eq('user_id', user.id)
        .order('times_seen', { ascending: false }),
      supabase
        .from('evidence_items')
        .select('id, title, body, context, skills, metrics, strength, used_count')
        .eq('user_id', user.id)
        .order('strength', { ascending: false }),
      supabase
        .from('resume_versions')
        .select('id, label, is_default, notes, text_content, storage_path')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('writing_style_notes, banned_constructions')
        .eq('id', user.id)
        .single(),
    ]);

  const questionRows = (questions ?? []) as unknown as Array<{
    id: string;
    text: string;
    kind: string;
    canonical_answer: string | null;
    times_seen: number;
    application_answers: Array<{ id: string; answer: string | null; status: string }>;
  }>;

  return (
    <>
      <PageHeader
        title="Material"
        description="What every application draws on: your answers, your stories, your resumes and how you write."
      />
      <MaterialView
        part={part}
        kind={kind}
        questions={questionRows.map((row) => ({
          id: row.id,
          text: row.text,
          kind: row.kind,
          canonicalAnswer: row.canonical_answer,
          timesSeen: row.times_seen,
          usedIn: row.application_answers.length,
          approvedAnswer:
            row.application_answers.find((a) => a.status === 'approved')?.answer ?? null,
        }))}
        evidence={(evidence ?? []).map((item) => ({
          id: item.id as string,
          title: item.title as string,
          body: item.body as string,
          context: (item.context as string) ?? null,
          skills: (item.skills as string[]) ?? [],
          metrics: (item.metrics as string) ?? null,
          strength: item.strength as number,
          usedCount: item.used_count as number,
        }))}
        resumes={(resumes ?? []).map((resume) => ({
          id: resume.id as string,
          label: resume.label as string,
          isDefault: resume.is_default as boolean,
          notes: (resume.notes as string) ?? null,
          // Whether it can be read, not the text: a resume is several kilobytes
          // and the client only needs to know the option is offerable.
          hasText: Boolean((resume.text_content as string | null)?.trim()),
          hasPdf: Boolean(resume.storage_path),
        }))}
        voice={{
          writingStyleNotes: (profile?.writing_style_notes as string) ?? '',
          bannedConstructions: ((profile?.banned_constructions as string[]) ?? []).join('\n'),
        }}
      />
    </>
  );
}
