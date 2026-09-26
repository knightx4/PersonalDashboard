import { fetchWikipediaImages, IMAGE_BATCH, WIKIPEDIA_PROVIDER_SLUG } from '@/lib/learn/providers/wikipedia';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Lead images for the Wikipedia articles stored before the article request
 * asked for one (learn migration 0060).
 *
 * One request to the MediaWiki API covers fifty articles, and no model is
 * involved, so the hourly top-up runs this first at no cost worth counting.
 * Each article is marked as asked whether or not it has an image, so the
 * queue empties and the call becomes a single read that finds nothing.
 * An article fetched since then already carries its image from that fetch.
 */
export async function backfillArticleImages(
  learn: LearnSupabaseClient,
): Promise<{ asked: number; found: number }> {
  const provider = await learn
    .from('catalogue_providers')
    .select('id')
    .eq('slug', WIKIPEDIA_PROVIDER_SLUG)
    .maybeSingle();
  if (provider.error) throw new Error(`Reading the Wikipedia provider failed: ${provider.error.message}`);
  if (!provider.data) return { asked: 0, found: 0 };

  const unchecked = await learn
    .from('catalogue_items')
    .select('id, title')
    .eq('provider_id', (provider.data as { id: string }).id)
    .eq('kind', 'article')
    .is('image_checked_at', null)
    .order('created_at')
    .limit(IMAGE_BATCH);
  if (unchecked.error) throw new Error(`Reading articles with no image failed: ${unchecked.error.message}`);
  const items = (unchecked.data ?? []) as { id: string; title: string }[];
  if (items.length === 0) return { asked: 0, found: 0 };

  const images = await fetchWikipediaImages(items.map((item) => item.title));
  if (!images) return { asked: 0, found: 0 };

  const checkedAt = new Date().toISOString();
  let asked = 0;
  let found = 0;
  for (const item of items) {
    // A title the answer left out is asked again next hour.
    if (!images.has(item.title)) continue;
    const image = images.get(item.title) ?? null;
    const { error } = await learn
      .from('catalogue_items')
      .update({ image_url: image?.url ?? null, image_file: image?.file ?? null, image_checked_at: checkedAt })
      .eq('id', item.id);
    if (error) throw new Error(`Storing ${item.title}'s image failed: ${error.message}`);
    asked += 1;
    if (image) found += 1;
  }
  return { asked, found };
}
