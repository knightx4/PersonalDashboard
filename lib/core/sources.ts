import type { ModuleSources } from '@/lib/sources/types';

/**
 * The shared core tables, as Goals reads them (lib/sources/types.ts). Most are
 * bookkeeping; mail itself is read through the Gmail connector, not from here.
 * The conversations with Dash about what they read are theirs, and are
 * sources. A new table in core goes in one of these two lists, or the gate
 * says so.
 */
export const coreSources: ModuleSources = {
  sources: [
    {
      table: 'core.conversations',
      module: 'Learn',
      holds: 'Conversations they had with Dash: about a Learn card or a newsletter story, one per thing read, or a question they asked from anywhere in the app.',
      weight: 'record',
      search: ['title'],
      title: 'title',
      note: "subject_kind says what it is about: 'feed_card' with subject_ref the learn.feed_cards id, 'news_story', or 'ask' for a question asked from anywhere, whose title is the question. The words are in core.conversation_turns, joined by conversation_id.",
    },
    {
      table: 'core.conversation_turns',
      module: 'Learn',
      holds: 'What they asked or explained, and what Dash replied, turn by turn.',
      weight: 'intent',
      search: ['body'],
      title: 'body',
      note: "role 'user' is theirs and 'assistant' is Dash's: read their turns as what they wanted to know, and Dash's only for context. On Dash's answers to an 'ask', citations lists the rows it relied on. conversation_id joins core.conversations, which says what the turn is about.",
    },
    {
      table: 'core.observations',
      module: 'Home',
      holds: 'What Dash noticed each week across their modules, with a number and the timeline rows behind it, and whether they found it useful.',
      weight: 'incidental',
      search: ['sentence'],
      title: 'sentence',
      note: "The sentence is Dash's, not theirs: read it as a lead to check against the rows in evidence (core.timeline refs, `schema.table:id`). verdict 'not_useful' means they did not want it; 'useful' that they did. week is the Monday it was written for.",
    },
  ],
  notSources: [
    { table: 'core.account_settings', reason: 'Settings.' },
    { table: 'core.email_accounts', reason: 'Mailbox connections and their tokens.' },
    { table: 'core.ingested_messages', reason: 'Mail sync bookkeeping; the Gmail connector reads mail.' },
    { table: 'core.model_spend', reason: 'Model cost accounting.' },
    { table: 'core.people', reason: 'Who a shopping order was for.' },
    { table: 'core.saved_views', reason: 'Saved list filters.' },
    { table: 'core.sync_jobs', reason: 'Sync bookkeeping.' },
    { table: 'public.profiles', reason: 'Display name and settings.' },
  ],
};
