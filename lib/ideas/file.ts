import type { SupabaseClient } from '@supabase/supabase-js';
import { findDuplicateIdea, type FiledIdea } from '@/lib/ideas/duplicate';
import { loadFiledIdeas } from '@/lib/ideas/load';

/**
 * Writing what the overnight run noticed onto the ideas page.
 *
 * #623 settled where those lines go: they are ideas under the person's own
 * list, marked as suggestions, rather than a card on Dash that is read once
 * and never acted on. The run makes three or four a night and it runs every
 * night, so the same observation about the same unshaped idea would otherwise
 * be filed again every morning.
 *
 * #642 settled which of a session's limits apply. The duplicate check does:
 * it is the thing that stops a week of nights filling the page with one
 * thought. The two-an-hour cap does not, because it exists to stop a session
 * filing ten follow-ons in a burst while it works, and a run that files three
 * lines once a night is not that. So nothing here reads lib/ideas/rate.ts.
 */

/** One line the run noticed, as the model reported it. */
export interface NightSuggestion {
  title: string;
  detail: string | null;
}

/**
 * The suggestion as one idea body: the line, then what to do about it.
 *
 * The same shape `scripts/plan.ts idea --file` writes -- first line is the
 * idea and the paragraph under it is the rest -- so the ideas page shows a
 * filed observation the way it shows every other suggestion.
 */
export function nightIdeaBody(suggestion: NightSuggestion): string {
  const title = suggestion.title.trim();
  const detail = suggestion.detail?.trim();
  return detail ? `${title}\n\n${detail}` : title;
}

/**
 * Files what the night noticed and returns how many rows it wrote.
 *
 * The count is what the morning summary prints (#631), so it is the number of
 * rows actually inserted rather than the number of suggestions considered.
 *
 * Each survivor is compared against what it just wrote as well as against the
 * page, so one night cannot file the same thought twice -- the model is given
 * the whole board at once and two of its lines can be about the same idea.
 *
 * A failed insert is logged and skipped rather than thrown, so one bad row
 * does not cost the rest of the night's ideas or the summary being written at
 * all. A failed read does throw: with no list to compare against, everything
 * would be filed as new.
 */
export async function fileNightIdeas(
  supabase: SupabaseClient,
  userId: string,
  suggestions: readonly NightSuggestion[],
): Promise<number> {
  const bodies = suggestions.map(nightIdeaBody).filter((body) => body.length > 0);
  // Nothing noticed is the common night. No read, no write, and the summary
  // prints no line about ideas.
  if (bodies.length === 0) return 0;

  const filed: FiledIdea[] = await loadFiledIdeas(supabase, userId);
  let written = 0;

  for (const body of bodies) {
    if (findDuplicateIdea(body, filed)) continue;

    const { data, error } = await supabase
      .from('ideas')
      .insert({ user_id: userId, body, module: null, source: 'claude' })
      .select('id')
      .single();

    if (error) {
      console.error('[dev digest] idea not filed', error.message);
      continue;
    }

    filed.unshift({ id: String((data as { id: string }).id), body });
    written += 1;
  }

  return written;
}
