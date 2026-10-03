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
      // Only a question asked from anywhere has a page of its own.
      page: {
        title: 'title',
        reads: ['subject_kind', 'subject_ref'],
        href: (row) => (row.subject_kind === 'ask' && row.subject_ref ? `/ask/${row.subject_ref}` : null),
      },
      note: "subject_kind says what it is about: 'row' for a thread under one row, with subject_ref that row's ref (schema.table:id, such as learn.feed_cards:<id> or news.saved_stories:<id>), or 'ask' for a question asked from anywhere, whose title is the question. The words are in core.conversation_turns, joined by conversation_id.",
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
    {
      table: 'core.year_reviews',
      module: 'Home',
      holds: 'What Dash wrote about each year from their timeline, with the year\'s counts and spend and the rows behind each paragraph.',
      weight: 'incidental',
      search: ['paragraphs'],
      title: 'year',
      ref: 'year',
      href: (year) => `/timeline/year/${year}`,
      page: {
        title: { reads: ['year'], of: (row) => `${row.year} in review` },
        reads: ['year'],
        href: (row) => `/timeline/year/${row.year}`,
      },
      note: "The paragraphs are Dash's, not theirs: each is {topic, text, evidence}, with evidence as core.timeline refs (`schema.table:id`). totals holds the counts per kind, spend per currency, each month, the top shops and the goals with steps done. complete is false while the year was still going when it was written; through is how far it read.",
    },
    {
      table: 'core.week_reviews',
      module: 'Home',
      holds: 'What Dash wrote about each week, Sunday to Saturday: the week\'s counted numbers per module, observations tied to their goals, and one thing to change next week.',
      weight: 'incidental',
      search: ['observations', 'change'],
      title: 'week',
      ref: 'week',
      href: (week) => `/home/week/${week}`,
      page: {
        title: { reads: ['week'], of: (row) => `The week of ${row.week}` },
        reads: ['week'],
        href: (row) => `/home/week/${row.week}`,
      },
      note: "The observations and the change are Dash's, not theirs: each observation is {text, goal_id, evidence}, with goal_id a goals.goals id or null and evidence as `schema.table:id` refs. facts holds the numbers counted for the week. week is the Sunday it starts on. change_kept says whether the previous week's change happened (null when unknown). source 'plain' means no model wrote it.",
    },
    {
      table: 'core.watches',
      module: 'Home',
      holds: 'Things they asked Dash to watch outside the app, such as a resale ticket price, with the price that should alert them and when the watch ends.',
      weight: 'intent',
      search: ['title', 'url'],
      title: 'title',
      note: "condition is what they are waiting for: {\"below\": 200} means they want to hear when the reading drops under 200 (in currency when set); {} means reports only. goal_item_id is the goals.items step it serves, when started from one. status 'running', 'ended' (ends_at passed) or 'stopped' (they stopped it). The readings are in core.watch_readings, joined by watch_id.",
    },
  ],
  notSources: [
    { table: 'core.account_settings', reason: 'Settings.' },
    { table: 'core.connector_calls', reason: 'Each call a connected Claude app made through the connector and the rows it returned, for the account page and the rate cap; the rows it points at are sources in their own modules.' },
    { table: 'core.connector_revocations', reason: 'When a connected app\'s access was removed, so its tokens stop working.' },
    { table: 'core.dash_handoffs', reason: 'Requests Ask Dash handed to the backup routine and whether it replied; the rows the routine wrote are sources in their own modules.' },
    { table: 'core.dash_actions', reason: 'Every change Dash made or proposed, from any surface, with the row it wrote, its values before and after, and whether it was done, declined or undone; the rows it wrote are sources in their own modules.' },
    { table: 'core.day_briefs', reason: 'The morning brief: up to three picks from the agenda, replies, bills, goals and Dash\'s results, derived each day.' },
    { table: 'core.drafted_messages', reason: 'Follow-ups and return requests Dash wrote from the pipeline and orders, waiting to be sent.' },
    { table: 'core.email_accounts', reason: 'Mailbox connections and their tokens.' },
    { table: 'core.inbox_catch_ups', reason: 'Sync bookkeeping.' },
    { table: 'core.page_views', reason: 'Which pages they opened and when, by route pattern, for the Usage tab in Dev and the vision review.' },
    { table: 'core.page_view_days', reason: 'Daily counts of page opens older than 180 days, rolled up from core.page_views.' },
    { table: 'core.ingested_messages', reason: 'Mail sync bookkeeping; the Gmail connector reads mail.' },
    { table: 'core.mail_piles', reason: 'The pile Jev sorted each ingested email into, compared with the linkers\' rules.' },
    { table: 'core.memory_chunks', reason: 'Vectors of passages from other tables, for search by meaning; read through the rows they point at.' },
    { table: 'core.memory_documents', reason: 'Copies of the spec files in docs/, so the memory sweep can embed them; the specs are read from the repository.' },
    { table: 'core.model_spend', reason: 'Model cost accounting.' },
    { table: 'core.people', reason: 'Who a shopping order was for.' },
    { table: 'core.push_subscriptions', reason: 'Browsers that accepted notifications, for sending the morning brief.' },
    { table: 'core.saved_views', reason: 'Saved list filters.' },
    { table: 'core.sync_jobs', reason: 'Sync bookkeeping.' },
    { table: 'core.watch_readings', reason: 'Each reading a watch took, for its trend and alerts; the watch itself is the source.' },
    { table: 'public.profiles', reason: 'Display name and settings.' },
  ],
};
