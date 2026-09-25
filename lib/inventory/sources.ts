import type { ModuleSources } from '@/lib/sources/types';

/**
 * Shopping's tables in public, as Goals reads them (lib/sources/types.ts).
 * What they own, what they bought and what they want to buy can bear on a
 * money goal or a goal that needs gear; the rest is catalogue and plumbing. A
 * new shopping table goes in one of these two lists, or the gate says so.
 */
export const shoppingSources: ModuleSources = {
  sources: [
    {
      table: 'public.saved_items',
      module: 'Shopping',
      holds: 'Things they want to buy, saved from shops, with their notes.',
      weight: 'intent',
      search: ['title', 'notes', 'url'],
      title: 'title',
      href: (id) => `/shopping/saved/${id}`,
    },
    {
      table: 'public.inventory_items',
      module: 'Shopping',
      holds: 'Things they own, with their notes.',
      weight: 'record',
      search: ['name', 'short_name', 'notes', 'search_tags'],
      title: 'name',
      href: (id) => `/shopping/inventory/${id}`,
    },
    {
      table: 'public.order_items',
      module: 'Shopping',
      holds: 'Each thing they bought, from their order emails.',
      weight: 'record',
      search: ['name', 'short_name', 'variant'],
      title: 'name',
      owner: 'order_id → orders.user_id',
      note: 'Prices and dates are on the row and its order; sum them for a spending goal rather than copying them.',
    },
  ],
  notSources: [
    { table: 'public.orders', reason: 'Order headers; read through order_items.' },
    { table: 'public.shipments', reason: 'Parcel tracking.' },
    { table: 'public.returns', reason: 'Return deadlines.' },
    { table: 'public.merchants', reason: 'The shared list of shops.' },
    { table: 'public.merchant_exclusions', reason: 'Mail filtering settings.' },
    { table: 'public.merchant_return_policies', reason: 'Return rules per shop.' },
    { table: 'public.ingested_messages', reason: 'Mail sync bookkeeping.' },
    { table: 'public.categories', reason: 'Labels for the inventory.' },
    { table: 'public.category_attribute_templates', reason: 'Field definitions for the inventory.' },
    { table: 'public.item_tags', reason: 'Labels for the inventory.' },
    { table: 'public.item_lists', reason: 'Labels for the inventory.' },
    { table: 'public.item_families', reason: 'Grouping for the inventory.' },
    { table: 'public.item_groups', reason: 'Grouping for the inventory.' },
    { table: 'public.item_uses', reason: 'Use counts; read through inventory_items.' },
    { table: 'public.inventory_item_families', reason: 'Join rows.' },
    { table: 'public.inventory_item_lists', reason: 'Join rows.' },
    { table: 'public.inventory_item_tags', reason: 'Join rows.' },
    { table: 'public.order_item_tags', reason: 'Join rows.' },
    { table: 'public.price_checks', reason: 'Resale price lookups.' },
    { table: 'public.item_price_quotes', reason: 'Resale price lookups.' },
    { table: 'public.book_details', reason: 'Book metadata for resale.' },
    { table: 'public.book_price_quotes', reason: 'Resale price lookups.' },
    { table: 'public.game_details', reason: 'Game metadata for resale.' },
    { table: 'public.game_price_quotes', reason: 'Resale price lookups.' },
    { table: 'public.fx_rates', reason: 'Exchange rates.' },
    { table: 'public.share_links', reason: 'Lists shared with other people.' },
    { table: 'public.share_link_items', reason: 'Lists shared with other people.' },
    { table: 'public.share_link_events', reason: 'Lists shared with other people.' },
    { table: 'public.share_link_responses', reason: 'Lists shared with other people.' },
    { table: 'public.share_link_tokens', reason: 'Lists shared with other people.' },
  ],
};
