import type { SupabaseClient } from '@supabase/supabase-js';
import { MOVED_TO_IDEAS } from '@/lib/feedback/load';
import { isSure, triageFrom, triageLine, type Triage } from '@/lib/feedback/triage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public'>;

/**
 * Moving what the header filed between the notes queue and the ideas page
 * (plan #1675).
 *
 * The header has one box, and everything written in it is saved as a note
 * first. When triage is sure the note is work to plan rather than one fix,
 * the server writes an idea from the same text and marks the note planned
 * with a resolution naming the idea. The note is kept, so nothing is lost,
 * and a planned note with that resolution is one the notes routine leaves
 * alone. The saved panel's flip moves it back: the note reopens and the
 * idea is dismissed, and a second flip restores that same idea rather than
 * writing another.
 */

/** Where a filed note ended up. */
export type FiledAs = 'note' | 'idea';

/** The resolution a note moved to the ideas page carries. */
export function movedResolution(body: string): string {
  return `${MOVED_TO_IDEAS} as the idea “${triageLine(body)}”.`;
}

/** Whether triage is sure this note is work to plan. An unsure answer stays a note. */
export function routesToPlan(triage: Triage | null): boolean {
  const route = triage?.route ?? null;
  return route !== null && route.value === 'plan' && isSure(route);
}

/** The workspace an idea from this note is filed under: triage's answer, or the whole app. */
export function ideaModule(triage: Triage | null): string | null {
  const scope = triage?.module?.value ?? null;
  return scope && scope !== 'app' ? scope : null;
}

export type MoveResult = { ok: true; ideaId: string } | { ok: false; error: string };

/**
 * Move a note to the ideas page: write an idea from its text (or restore the
 * one an earlier flip dismissed), then mark the note planned. Only ever the
 * caller's own rows.
 */
export async function moveNoteToIdea(
  supabase: Client,
  input: { userId: string; noteId: string; ideaId?: string | null },
): Promise<MoveResult> {
  const { userId, noteId } = input;
  const { data: note } = await supabase
    .from('feedback_items')
    .select('body, triage')
    .eq('id', noteId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!note) return { ok: false, error: 'That note no longer exists.' };
  const body = String(note.body);

  let ideaId: string | null = null;
  if (input.ideaId) {
    const { data: restored } = await supabase
      .from('ideas')
      .update({ dismissed_at: null })
      .eq('id', input.ideaId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    ideaId = restored ? String(restored.id) : null;
  }
  if (!ideaId) {
    const triage = triageFrom(note.triage);
    const { data: idea, error } = await supabase
      .from('ideas')
      .insert({
        user_id: userId,
        body,
        module: ideaModule(triage),
        source: 'me',
        triage: note.triage ?? null,
      })
      .select('id')
      .single();
    if (error || !idea) return { ok: false, error: error?.message ?? 'The idea could not be saved.' };
    ideaId = String(idea.id);
  }

  const { error } = await supabase
    .from('feedback_items')
    .update({ status: 'planned', resolution_note: movedResolution(body) })
    .eq('id', noteId)
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, ideaId };
}

/**
 * Move it back: dismiss the idea and reopen the note. Refused once the idea
 * has been shaped into the plan, since a proposal now hangs from it.
 */
export async function moveIdeaToNote(
  supabase: Client,
  input: { userId: string; noteId: string; ideaId: string },
): Promise<MoveResult> {
  const { userId, noteId, ideaId } = input;
  const { data: idea } = await supabase
    .from('ideas')
    .select('id, plan_item_id')
    .eq('id', ideaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!idea) return { ok: false, error: 'That idea no longer exists.' };
  if (idea.plan_item_id) return { ok: false, error: 'This idea is already in the plan.' };

  const { error: noteError } = await supabase
    .from('feedback_items')
    .update({ status: 'open', resolution_note: null })
    .eq('id', noteId)
    .eq('user_id', userId)
    .eq('status', 'planned');
  if (noteError) return { ok: false, error: noteError.message };

  const { error } = await supabase
    .from('ideas')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', ideaId)
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, ideaId };
}
