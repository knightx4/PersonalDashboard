'use server';

import { createClient, getUser } from '@/lib/auth/server';
import { PLAN_MOCKUPS_BUCKET, type MockupPicture, type MockupWidth } from '@/lib/plan/mockups';

/** An hour: long enough to read a page of questions, short enough to expire. */
const SIGNED_FOR_SECONDS = 3600;
const MOST_QUESTIONS = 60;

/**
 * The pictures kept with these questions, each with a link to its file that
 * works for an hour (plan #2810.2). Read on the signed-in account: the table's
 * policy and the bucket's both limit it to the account's own rows and folder.
 * A question with no pictures is simply not in the answer.
 */
// latency: pending
export async function loadQuestionMockups(
  itemIds: string[],
): Promise<Record<string, MockupPicture[]>> {
  const user = await getUser();
  if (!user) return {};
  const ids = [...new Set(itemIds)].slice(0, MOST_QUESTIONS);
  if (ids.length === 0) return {};

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('plan_item_mockups')
    .select('item_id, option_letter, width, storage_path, link')
    .eq('user_id', user.id)
    .in('item_id', ids);
  if (!rows || rows.length === 0) return {};

  const { data: signed } = await supabase.storage
    .from(PLAN_MOCKUPS_BUCKET)
    .createSignedUrls(
      rows.map((row) => row.storage_path as string),
      SIGNED_FOR_SECONDS,
    );
  const urlOf = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlOf.set(entry.path, entry.signedUrl);
  }

  const out: Record<string, MockupPicture[]> = {};
  for (const row of rows) {
    const url = urlOf.get(row.storage_path as string);
    if (!url) continue;
    (out[row.item_id as string] ??= []).push({
      letter: (row.option_letter as string | null) ?? null,
      width: row.width as MockupWidth,
      url,
      link: (row.link as string | null) ?? null,
    });
  }
  return out;
}
