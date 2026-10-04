import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadSpec } from '@/lib/specs/load';
import { specBySlug } from '@/lib/specs/registry';
import { ruleStates } from '@/lib/specs/rule-states';
import { loadLatestFindings } from '@/lib/specs/findings';
import { SPEC_COUNTERS } from '@/scripts/spec-counts';
import specBaseline from '@/scripts/spec-baseline.json';
import { SpecDocView } from './spec-doc-view';

/**
 * Names and targets only: the counters' `measure` is never called here, since
 * what it walks is not deployed. The numbers are the baseline file's.
 */
const COUNTERS = new Map(SPEC_COUNTERS.map((c) => [c.name, { target: c.target }]));

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: specBySlug(slug)?.title ?? 'Spec' };
}

/**
 * One specification, section by section, each with a thread under it.
 *
 * The document is cut on its top-level headings and nothing else. A comment on
 * 650 lines is a comment on nothing; a comment on "What an edge is" is a
 * comment on a decision, and the `##` sections of these documents are the
 * things somebody actually disagrees with.
 *
 * The prose renders through the vault's markdown pipeline, raw HTML disabled,
 * which is the same sanitizer for the same reason -- and here the content is
 * the repository's own, so the only thing it guards against is a document that
 * happens to contain markup.
 */
export default async function SpecPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = specBySlug(slug);
  if (!doc) notFound();

  const user = await requireUser();
  const supabase = await createClient();
  const [{ sections, orphans, rules }, audit] = await Promise.all([
    loadSpec(supabase, user.id, doc),
    loadLatestFindings(supabase, user.id, [doc.slug]),
  ]);
  const states = rules
    ? ruleStates(rules, { baseline: specBaseline as Record<string, number>, counters: COUNTERS })
    : [];

  return <SpecDocView doc={doc} sections={sections} orphans={orphans} states={states} audit={audit} />;
}
