/**
 * What kind of opening a role is (migration job-search 0067). Most are jobs;
 * an accelerator that takes the person as a founder, a fellowship or a grant
 * goes through the same pipeline, and the kind names it.
 */
export const ROLE_KINDS = ['job', 'accelerator', 'fellowship', 'grant', 'other'] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

export const ROLE_KIND_LABELS: Record<RoleKind, string> = {
  job: 'Job',
  accelerator: 'Accelerator',
  fellowship: 'Fellowship',
  grant: 'Grant',
  other: 'Other',
};

export function isRoleKind(value: unknown): value is RoleKind {
  return typeof value === 'string' && (ROLE_KINDS as readonly string[]).includes(value);
}

/** The label a page shows beside a role, or null for a job, which needs none. */
export function roleKindLabel(kind: string | null | undefined): string | null {
  if (!isRoleKind(kind) || kind === 'job') return null;
  return ROLE_KIND_LABELS[kind];
}
