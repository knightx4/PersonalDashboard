import type { ModuleSources } from '@/lib/sources/types';

/**
 * News's tables, as Goals reads them (lib/sources/types.ts). A story they
 * saved says more than one they were sent. A new table in news goes in one of
 * these two lists, or the gate says so.
 */
export const newsSources: ModuleSources = {
  sources: [
    {
      table: 'news.saved_stories',
      module: 'News',
      holds: 'Stories from their newsletters they chose to keep.',
      weight: 'record',
      search: ['headline', 'summary', 'text'],
      title: 'headline',
      href: () => '/news/saved',
    },
    {
      table: 'news.preferences',
      module: 'News',
      holds: 'The neighbourhood they want local news for.',
      weight: 'intent',
      search: ['local_area'],
      title: 'local_area',
      ref: 'user_id',
      href: () => '/news/settings',
    },
    {
      table: 'news.issues',
      module: 'News',
      holds: 'Every newsletter issue they receive, with its summary.',
      weight: 'incidental',
      search: ['subject', 'summary', 'text_body'],
      title: 'subject',
      href: (id) => `/news/i/${id}`,
      note: 'Leads only: an issue mentioning a subject says nothing about what they want.',
    },
  ],
  notSources: [
    { table: 'news.addresses', reason: 'Inbound mail addresses.' },
    { table: 'news.hidden_topics', reason: 'Topics hidden from the digest.' },
    { table: 'news.recommendations', reason: 'The digest’s own picks.' },
    { table: 'news.senders', reason: 'Newsletter senders.' },
    { table: 'news.story_groups', reason: 'Clustering of stories for the digest.' },
    { table: 'news.story_passes', reason: 'Stories passed over.' },
    { table: 'news.story_reactions', reason: 'Thumbs up and down on Quick read cards.' },
  ],
};
