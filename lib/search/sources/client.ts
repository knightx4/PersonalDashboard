import 'server-only';

import type { SearchListContext, SearchSchema } from '@/lib/search/sources';

/**
 * The client a search source reads one schema through: the caller's, when it
 * passed its own (Dash, over any surface), or the source's own cookie client
 * in the command box.
 */
export async function sourceClient<T>(ctx: SearchListContext, schema: SearchSchema, own: () => Promise<T>): Promise<T> {
  return ctx.db ? ((await ctx.db(schema)) as T) : own();
}
