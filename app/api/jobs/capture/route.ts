import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient, getUser } from '@/lib/jobs/auth/server';
import { guessQuestionKind, looksLikeQuestion, questionFingerprint } from '@/lib/jobs/fingerprint';
import { detectPosting } from '@/lib/jobs/ats';

/**
 * The bookmarklet's endpoint.
 *
 * Authenticated by SESSION COOKIE, never by a token in the URL — a token in a
 * bookmarklet is a token in the browser history, in screenshots, and in any
 * page that reads document.referrer. The user_id comes from the session and
 * nowhere else.
 *
 * The bookmarklet runs on an ATS origin, so this is a cross-origin request. It
 * is deliberately restricted to same-site cookies plus an explicit CORS allow
 * for credentials, and the only thing it can do is add questions.
 */

const captureSchema = z.object({
  url: z.string().url(),
  title: z.string().max(300).optional(),
  questions: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(600),
        required: z.boolean().optional(),
        inputType: z.string().max(40).optional(),
      }),
    )
    .max(120),
});

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request);

  const user = await getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in first, then click the bookmarklet again.' },
      { status: 401, headers },
    );
  }

  const parsed = captureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'That page did not send anything usable.' }, { status: 400, headers });
  }

  const supabase = await createClient();

  // Filter out the fields every form has. Without this the bank fills up with
  // "First name" and EEO questions and stops being worth opening.
  const questions = parsed.data.questions.filter((question) => looksLikeQuestion(question.text));
  if (questions.length === 0) {
    return NextResponse.json(
      { added: 0, matchedRole: null, note: 'Only standard fields were found on that page.' },
      { headers },
    );
  }

  // Match the page to a role: by ATS job id from the URL first, then by the
  // application host against the role's saved link.
  const detected = detectPosting(parsed.data.url);
  const host = new URL(parsed.data.url).hostname.toLowerCase();

  let applicationId: string | null = null;
  let matchedRole: string | null = null;

  const { data: roles } = await supabase
    .from('roles')
    .select('id, title, jd_url, ats_job_id, applications ( id, status, created_at )')
    .eq('user_id', user.id)
    .order('first_seen_at', { ascending: false })
    .limit(500);

  type RoleRow = {
    id: string;
    title: string;
    jd_url: string | null;
    ats_job_id: string | null;
    applications: Array<{ id: string; status: string; created_at: string }>;
  };

  const candidates = (roles ?? []) as unknown as RoleRow[];

  const byJobId = detected.jobId
    ? candidates.find((role) => role.ats_job_id && role.ats_job_id === detected.jobId)
    : undefined;

  const byHost =
    byJobId ??
    candidates.find((role) => {
      if (!role.jd_url) return false;
      try {
        return new URL(role.jd_url).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    });

  if (byHost) {
    const application = [...byHost.applications].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )[0];
    if (application) {
      applicationId = application.id;
      matchedRole = byHost.title;
    }
  }

  let added = 0;

  for (const question of questions) {
    const fingerprint = questionFingerprint(question.text);

    const { data: existing } = await supabase
      .from('questions')
      .select('id, times_seen')
      .eq('user_id', user.id)
      .eq('fingerprint', fingerprint)
      .maybeSingle();

    let questionId: string;

    if (existing) {
      questionId = existing.id as string;
      await supabase
        .from('questions')
        .update({ times_seen: (existing.times_seen as number) + 1 })
        .eq('id', questionId);
    } else {
      const { data: created, error } = await supabase
        .from('questions')
        .insert({
          user_id: user.id,
          text: question.text,
          fingerprint,
          kind: guessQuestionKind(question.text),
        })
        .select('id')
        .single();
      if (error || !created) continue;
      questionId = created.id as string;
      added += 1;
    }

    if (applicationId) {
      await supabase.from('application_answers').insert({
        user_id: user.id,
        application_id: applicationId,
        question_id: questionId,
      });
    }
  }

  return NextResponse.json({ added, matchedRole, total: questions.length }, { headers });
}
