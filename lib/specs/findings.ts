/**
 * What the weekly spec audit found, read back for the spec pages in Dev
 * (plan #1525, docs/SPEC-LAYER-SPEC.md part 2).
 *
 * Each audit run writes its rows to `spec_findings` under one `audit_id`
 * (.claude/skills/spec-audit). A page shows the latest run only: an earlier
 * run's "drifted" may since have been fixed, and the latest run would have
 * said so.
 *
 * The notes routine also writes `missing_rule` findings, one at a time and
 * with no `audit_id` (plan #1526). Those filed since the latest audit began
 * are shown with it, because the next audit has not had the chance to read
 * them yet. Older ones are left to that audit, which records what still
 * stands under its own id.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpecChangeStatus, SpecFindingKind, SpecFindingProposal } from './changes';

/** The change a finding led to, as much of it as a link needs. */
export type FindingChange = { id: string; title: string; status: SpecChangeStatus };

export type SpecFinding = {
  id: string;
  spec: string;
  section: string | null;
  kind: SpecFindingKind;
  finding: string;
  evidence: string;
  proposal: SpecFindingProposal;
  change: FindingChange | null;
  /** Null for a finding the notes routine filed on its own. */
  auditId: string | null;
  createdAt: string;
};

/** The latest audit's findings, or nothing when no audit has run. */
export type LatestFindings = {
  /** When the latest audit wrote its first row; null when none has run. */
  auditAt: string | null;
  findings: SpecFinding[];
};

/**
 * The order the kinds are read in: what needs doing first, what holds last.
 * A rule the notes keep asking for comes after drift and gaps because it is a
 * suggestion, not a fault.
 */
export const FINDING_KIND_ORDER: readonly SpecFindingKind[] = [
  'drifted',
  'missing',
  'undescribed',
  'missing_rule',
  'holds',
];

export const FINDING_KIND_LABEL: Record<SpecFindingKind, string> = {
  drifted: 'Drifted from the spec',
  missing: 'Described but not built',
  undescribed: 'Built but not described',
  missing_rule: 'Rules the notes keep asking for',
  holds: 'Holds',
};

export type FindingGroup = { kind: SpecFindingKind; findings: SpecFinding[] };

/** Findings grouped by kind, in FINDING_KIND_ORDER, with empty kinds left out. */
export function groupFindings(findings: readonly SpecFinding[]): FindingGroup[] {
  return FINDING_KIND_ORDER.map((kind) => ({
    kind,
    findings: findings.filter((f) => f.kind === kind),
  })).filter((group) => group.findings.length > 0);
}

const FINDING_COLUMNS =
  'id, spec, section, kind, finding, evidence, proposal, audit_id, created_at, ' +
  'spec_changes (id, title, status)';

type FindingRow = {
  id: string;
  spec: string;
  section: string | null;
  kind: SpecFindingKind;
  finding: string;
  evidence: string;
  proposal: SpecFindingProposal;
  audit_id: string | null;
  created_at: string;
  spec_changes: FindingChange | FindingChange[] | null;
};

export function specFindingFrom(row: FindingRow): SpecFinding {
  const change = Array.isArray(row.spec_changes) ? (row.spec_changes[0] ?? null) : row.spec_changes;
  return {
    id: row.id,
    spec: row.spec,
    section: row.section,
    kind: row.kind,
    finding: row.finding,
    evidence: row.evidence,
    proposal: row.proposal,
    change: change ? { id: change.id, title: change.title, status: change.status } : null,
    auditId: row.audit_id,
    createdAt: row.created_at,
  };
}

/**
 * The latest audit's findings for some specs, keyed by spec, with the
 * missing_rule findings the notes routine filed since. `specs` are registry
 * slugs or, for a workspace with no spec, workspace ids.
 */
export async function loadLatestFindings(
  supabase: SupabaseClient,
  userId: string,
  specs: readonly string[],
): Promise<LatestFindings> {
  if (specs.length === 0) return { auditAt: null, findings: [] };

  const { data: last, error: lastError } = await supabase
    .from('spec_findings')
    .select('audit_id, created_at')
    .eq('user_id', userId)
    .not('audit_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) {
    console.error(`Could not read the latest spec audit: ${lastError.message}`);
    return { auditAt: null, findings: [] };
  }
  const auditId = (last?.audit_id as string | null | undefined) ?? null;

  // The run's own start: its earliest row, since one run writes for a while.
  let auditAt: string | null = null;
  if (auditId) {
    const { data: first } = await supabase
      .from('spec_findings')
      .select('created_at')
      .eq('user_id', userId)
      .eq('audit_id', auditId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    auditAt = (first?.created_at as string | undefined) ?? (last?.created_at as string);
  }

  const fromAudit = auditId
    ? supabase
        .from('spec_findings')
        .select(FINDING_COLUMNS)
        .eq('user_id', userId)
        .eq('audit_id', auditId)
        .in('spec', [...specs])
        .order('created_at', { ascending: true })
    : null;
  let fromNotes = supabase
    .from('spec_findings')
    .select(FINDING_COLUMNS)
    .eq('user_id', userId)
    .is('audit_id', null)
    .eq('kind', 'missing_rule')
    .in('spec', [...specs])
    .order('created_at', { ascending: true });
  if (auditAt) fromNotes = fromNotes.gte('created_at', auditAt);

  const [audit, notes] = await Promise.all([fromAudit, fromNotes]);
  for (const result of [audit, notes]) {
    if (result?.error) console.error(`Could not read the spec findings: ${result.error.message}`);
  }
  const rows = [
    ...((audit?.data ?? []) as unknown as FindingRow[]),
    ...((notes.data ?? []) as unknown as FindingRow[]),
  ];
  return { auditAt, findings: rows.map(specFindingFrom) };
}

/**
 * Where a finding's change can be read, or null once it has been decided.
 * Open changes are drawn on /dev/specs under "Changes to specs", each at the
 * anchor spec-change-card.tsx gives it; an applied or declined one is drawn
 * nowhere, so the finding names it without a link.
 */
export function findingChangeHref(change: FindingChange): string | null {
  return change.status === 'proposed' || change.status === 'approved'
    ? `/dev/specs#spec-change-${change.id}`
    : null;
}
