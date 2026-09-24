'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { serverEnv } from '@/lib/env';
import { createNewsClient } from '@/lib/news/auth/server';
import { makeRecommendations } from '@/lib/news/recommend/make';
import type { NewsletterPick } from '@/lib/news/recommend/picks';

/**
 * What the recommended view holds after a run (plan #947).
 *
 * `idle` is before any run on this visit. `made` carries the new list, so the
 * page can show it without reading the row back. `failed` carries the reason
 * in words; the stored list is untouched by a failed run (make.ts), so the
 * page goes on showing whatever it had.
 */
export type RecommendState =
  | { status: 'idle' }
  | { status: 'made'; picks: NewsletterPick[]; madeAt: string }
  | { status: 'failed'; message: string };

function apiKey(): string | undefined {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? undefined;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? undefined;
  }
}

/**
 * Make a new list of recommended newsletters and store it in place of the old
 * one. The view's first run and its Reload button both call this.
 *
 * A run asks Opus to search the web for each topic and takes about a minute,
 * which is why the page starts it from the browser rather than waiting on it
 * to render, and why app/news/all/page.tsx raises the time limit its actions
 * run under.
 *
 * It is handed to useActionState, which passes the last state and the form.
 * Neither changes what a run does, so it takes no arguments.
 */
// latency: pending -- a run searches for about a minute; the old list stays on screen until the new one arrives
export async function remakeRecommendations(): Promise<RecommendState> {
  const user = await requireUser();
  const [news, core] = await Promise.all([createNewsClient(), createCoreClient()]);

  const result = await makeRecommendations({
    news,
    spend: core,
    userId: user.id,
    anthropicApiKey: apiKey(),
  });

  if (!result.ok) {
    const message =
      result.reason === 'no-key'
        ? 'This deployment has no ANTHROPIC_API_KEY, so no list can be made.'
        : result.detail;
    return { status: 'failed', message };
  }

  revalidatePath('/news/all');
  return { status: 'made', picks: result.picks, madeAt: result.madeAt };
}
