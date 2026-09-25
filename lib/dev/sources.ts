import type { ModuleSources } from '@/lib/sources/types';

/**
 * The dev workspace's tables, as Goals reads them (lib/sources/types.ts): all
 * of them are about building this app rather than the person's life, so none
 * is a source. A new dev table goes in one of these two lists, or the gate
 * says so.
 */
const ABOUT_THE_APP = 'About building this app, not the person’s life.';

export const devSources: ModuleSources = {
  sources: [],
  notSources: [
    'public.ideas',
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
    'public.spec_sections',
    'public.ui_findings',
    'public.ui_reviews',
  ].map((table) => ({ table, reason: ABOUT_THE_APP })),
};
