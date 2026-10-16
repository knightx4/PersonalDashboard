import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { getReadingText } from '@/lib/learn/locate/reading-text';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { loadReading, type ReadingSummary } from './load';
import { summarizeReadingText } from './reading-summary-model';
import { setReadingSummary } from './save';

export type SummarizeResult =
  | { ok: true; summary: ReadingSummary; title: string }
  | {
      ok: false;
      error: string;
      /** True when the reading's text could not be read: the page points to paste or upload. */
      unreadable?: boolean;
    };

const COULD_NOT = 'Dash could not write a summary this time. Try again in a moment.';

/**
 * Summarize, and Redo (plan #1876.4): one model call over the reading's text,
 * kept on the reading so it shows again on later visits. The reading page's
 * button and Dash's summarize_reading (lib/dash/paid-tools-learn.ts) both
 * call this.
 *
 * The text is what getReadingText returns: the text you gave the reading when
 * there is some, its link otherwise. A link Dash cannot read costs nothing and
 * comes back as the paste-or-upload message.
 */
export async function summarizeReadingFor(
  supabase: LearnSupabaseClient,
  userId: string,
  readingId: string,
): Promise<SummarizeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Summarize needs the Anthropic key, which is not set on this deployment.' };

  try {
    const reading = await loadReading(supabase, readingId);
    if (!reading) return { ok: false, error: 'That reading is not there any more.' };

    const text = await getReadingText(supabase, {
      id: reading.id,
      url: reading.openUrl ?? reading.source?.canonicalUrl ?? null,
    });
    if (!text.ok) return { ok: false, error: text.message, unreadable: true };

    const spend = collectSpend();
    const result = await summarizeReadingText({
      title: reading.subject,
      why: reading.why,
      text: text.text,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(userId, 'summarize-reading', spend.reports);
    if (!result.ok) {
      console.error('[reading summary]', result.detail);
      return { ok: false, error: COULD_NOT };
    }

    const saved = { text: result.text, from: text.from, label: text.label, truncated: text.truncated };
    const found = await setReadingSummary(supabase, reading.id, saved);
    if (!found) return { ok: false, error: 'That reading is not there any more.' };
    return { ok: true, summary: { ...saved, writtenAt: new Date().toISOString() }, title: reading.subject };
  } catch (error) {
    console.error('[reading summary]', error instanceof Error ? error.message : error);
    return { ok: false, error: COULD_NOT };
  }
}
