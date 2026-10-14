import 'server-only';

import { after } from 'next/server';
import { z } from 'zod';
import type { createClient } from '@/lib/auth/server';
import type { CaptureRowWrite } from '@/lib/capture/file';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { createCoreClient } from '@/lib/core/auth/server';
import { isOwner, type OwnerCheck } from '@/lib/dev/owner';
import { moveNoteToIdea, routesToPlan } from '@/lib/feedback/move';
import { triageRow } from '@/lib/feedback/triage-run';
import { scoreIdeaRow } from '@/lib/ideas/score-run';
import { jevEnabledFor } from '@/lib/jev/enabled';

/**
 * A note for Dev and an idea, written from capture (plan #1950.5). The
 * header's notes button and the Add buttons on /dev/bugs and /dev/ideas open
 * capture aimed at these, and these write the rows the old forms wrote.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
type SessionUser = NonNullable<OwnerCheck['user']>;

const Body = z.string().trim().min(3, 'Write a sentence or two describing it.').max(4000);
const PagePath = z.string().max(300).nullable();

/**
 * A note in the queue, as a request until triage says it is a bug, with the
 * page it was filed from. Open to every signed-in account, as the header's
 * button always was: a bug is a bug whoever hit it.
 *
 * Triage runs once the note is saved, so saving never waits on Jev. A note
 * triage is sure needs planning moves to the ideas page (plan #1675), the
 * owner's notes only, and that idea is then scored.
 */
export async function writeDevNote(
  supabase: Supabase,
  user: SessionUser,
  body: string,
  pagePath: string | null,
  userAgent: string | null,
): Promise<CaptureRowWrite> {
  const text = Body.safeParse(body);
  if (!text.success) return { ok: false, error: text.error.issues[0].message };
  const page = PagePath.safeParse(pagePath);
  const { data, error } = await supabase
    .from('feedback_items')
    .insert({
      user_id: user.id,
      kind: 'feature',
      body: text.data,
      page_path: page.success ? page.data : null,
      user_agent: userAgent ? userAgent.slice(0, 500) : null,
    })
    .select('id')
    .single();
  if (error || !data?.id) return { ok: false, error: 'The note could not be saved. Try again.' };
  const id = String(data.id);

  after(async () => {
    try {
      const core = await createCoreClient();
      if (!(await jevEnabledFor(core, user.id))) return;
      const spend: SpendReport[] = [];
      const triage = await triageRow(supabase, { userId: user.id, table: 'feedback_items', id, spend });
      await recordSessionSpend(user.id, { module: 'core', operation: 'triage-note' }, spend);
      if (!routesToPlan(triage) || !(await isOwner({ user, supabase }))) return;
      const moved = await moveNoteToIdea(supabase, { userId: user.id, noteId: id });
      if (!moved.ok) return;
      const scoreSpend: SpendReport[] = [];
      await scoreIdeaRow(supabase, { userId: user.id, id: moved.ideaId, triage, spend: scoreSpend });
      await recordSessionSpend(user.id, { module: 'core', operation: 'score-idea' }, scoreSpend);
    } catch (problem) {
      console.warn('[capture] triaging a note failed', problem);
    }
  });

  return { ok: true, id };
}

/**
 * An idea, about the app as a whole until the person says otherwise on its
 * page. The ideas page is the owner's alone, so the caller has checked.
 */
export async function writeIdea(supabase: Supabase, userId: string, body: string): Promise<CaptureRowWrite> {
  const text = Body.safeParse(body);
  if (!text.success) return { ok: false, error: 'Write a sentence.' };
  const { data, error } = await supabase
    .from('ideas')
    .insert({ user_id: userId, body: text.data, module: null })
    .select('id')
    .single();
  if (error || !data?.id) return { ok: false, error: 'The idea could not be saved. Try again.' };
  return { ok: true, id: String(data.id) };
}
