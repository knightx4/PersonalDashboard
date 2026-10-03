import { planRefHref } from '@/lib/comments/refs';
import type { ModuleSources, Page } from '@/lib/sources/types';

/**
 * The dev workspace's tables, as Goals reads them (lib/sources/types.ts).
 * Almost all are about building this app rather than the person's life, so
 * they are not sources. The exception is the posts they put up about it: what
 * they posted is a record of something they did in public. A new dev table
 * goes in one of these two lists, or the gate says so.
 */
const ABOUT_THE_APP = 'About building this app, not the person’s life.';

/**
 * The dev rows a ref can open (lib/core/refs.ts). A plan step opens on the
 * plan filtered to its number; the rest open on their list with the row's
 * anchor, the same addresses Dash's lookups link to (lib/ask/dev.ts).
 */
const PAGES: Record<string, Page> = {
  'public.plan_items': {
    title: 'title',
    reads: ['number'],
    href: (row) => (typeof row.number === 'number' ? planRefHref(row.number) : null),
  },
  'public.ideas': { title: 'body', href: (row) => `/dev/ideas#idea-${row.id}` },
  'public.feedback_items': { title: 'body', href: (row) => `/dev/bugs#note-${row.id}` },
  'public.raised_items': { title: 'title', href: (row) => `/dev/raised#raise-${row.id}` },
};

export const devSources: ModuleSources = {
  sources: [
    {
      table: 'public.social_posts',
      module: 'Dev',
      holds: 'Posts about building this app that Dash drafted for X, and which ones they posted, with the link.',
      weight: 'record',
      search: ['angle', 'body'],
      title: 'angle',
      href: () => '/dev/posts',
      note: 'Only rows with status posted are things they did; suggested and dropped rows are Dash’s drafts. body is a jsonb array, one string per post in a thread.',
    },
  ],
  notSources: [
    'public.check_backs',
    'public.ideas',
    'public.inspiration_settings',
    'public.inspiration_takeaway_videos',
    'public.inspiration_takeaways',
    'public.inspiration_videos',
    'public.plan_items',
    'public.plan_dependencies',
    'public.plan_runs',
    'public.plan_commit_checks',
    'public.plan_main_checks',
    'public.plan_overnight_runs',
    'public.plan_seed_imports',
    'public.dev_comments',
    'public.dev_comment_reads',
    'public.dev_digests',
    'public.feedback_items',
    'public.module_visions',
    'public.raised_items',
    'public.spec_changes',
    'public.spec_findings',
    'public.spec_sections',
    'public.ui_findings',
    'public.ui_reviews',
    'public.vision_reviews',
  ].map((table) => ({ table, reason: ABOUT_THE_APP, page: PAGES[table] })),
};
