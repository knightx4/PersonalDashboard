import { NO_GROUP, type ListDisplaySpec } from '@/lib/list-display';
import { APPLICATION_STATUSES, SOURCE_LABELS } from '@/lib/jobs/pipeline';
import type { PipelineRow } from '@/lib/jobs/applications/load';

/**
 * What the roles table offers: the six sorts it already had, three groupings
 * it did not, and the columns a row can lose.
 *
 * The sorts keep their ids and their default, because they are the ones the
 * column headers link to and the ones in every bookmark: the header and the
 * Display panel are two ways to the same parameter, so they cannot disagree
 * about what is sorted.
 */

export type RolesSortKey =
  | 'activity'
  | 'company'
  | 'title'
  | 'status'
  | 'applied'
  | 'excitement';

/** The role title is the only cell that says which row this is, so it stays. */
export const ROLE_PROPERTIES = [
  { id: 'title', label: 'Role', alwaysOn: true },
  { id: 'company', label: 'Company' },
  { id: 'status', label: 'Status' },
  { id: 'activity', label: 'Last activity' },
  { id: 'applied', label: 'Date applied' },
  { id: 'excitement', label: 'Excitement' },
  { id: 'comp', label: 'Comp' },
] as const;

export function rolesDisplay(): ListDisplaySpec<PipelineRow> {
  const byActivity = (a: PipelineRow, b: PipelineRow) =>
    (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '');

  return {
    pathname: '/jobs/roles',
    sorts: [
      { id: 'title', label: 'Role', compare: (a, b) => a.roleTitle.localeCompare(b.roleTitle) },
      {
        id: 'company',
        label: 'Company',
        compare: (a, b) => a.companyName.localeCompare(b.companyName),
      },
      {
        id: 'status',
        label: 'Status',
        compare: (a, b) =>
          APPLICATION_STATUSES.indexOf(a.status) - APPLICATION_STATUSES.indexOf(b.status),
      },
      { id: 'activity', label: 'Last activity', compare: byActivity },
      {
        id: 'applied',
        label: 'Date applied',
        compare: (a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''),
      },
      {
        id: 'excitement',
        label: 'Excitement',
        compare: (a, b) => (b.excitement ?? 0) - (a.excitement ?? 0),
      },
    ],
    groups: [
      {
        id: 'status',
        label: 'Status',
        // Ranked, because a pursuit moves through these in order and
        // alphabetical would scatter that.
        bucket: (row) => ({
          key: row.status,
          label: row.status.replace(/_/g, ' '),
          rank: APPLICATION_STATUSES.indexOf(row.status),
        }),
      },
      {
        id: 'company',
        label: 'Company',
        bucket: (row) => ({ key: row.companySlug, label: row.companyName }),
      },
      {
        id: 'source',
        label: 'Source',
        bucket: (row) =>
          row.source
            ? { key: row.source, label: SOURCE_LABELS[row.source] ?? row.source }
            : null,
        emptyLabel: 'No source',
      },
    ],
    properties: [...ROLE_PROPERTIES],
    defaultSort: 'activity',
    defaultGroup: NO_GROUP,
  };
}

/** What the companies table offers. It had no sort control at all. */
export type CompanyLike = {
  name: string;
  priority: string;
  /** The activity status the table draws, e.g. `in_process`. */
  status: string;
};

const PRIORITY_ORDER = ['target', 'interested', 'backup', 'passed'];

export function companiesDisplay<T extends CompanyLike>(): ListDisplaySpec<T> {
  const rank = (priority: string) => {
    const index = PRIORITY_ORDER.indexOf(priority);
    return index === -1 ? PRIORITY_ORDER.length : index;
  };

  return {
    pathname: '/jobs/companies',
    sorts: [
      { id: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
      {
        id: 'priority',
        label: 'Priority',
        compare: (a, b) => rank(a.priority) - rank(b.priority) || a.name.localeCompare(b.name),
      },
      {
        id: 'activity',
        label: 'Activity',
        compare: (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
      },
    ],
    groups: [
      {
        id: 'priority',
        label: 'Priority',
        bucket: (company) => ({
          key: company.priority,
          label: company.priority,
          rank: rank(company.priority),
        }),
      },
    ],
    properties: [
      { id: 'name', label: 'Company', alwaysOn: true },
      { id: 'priority', label: 'Priority' },
      { id: 'activity', label: 'Activity' },
      { id: 'roles', label: 'Roles' },
      { id: 'domains', label: 'Domains' },
    ],
    defaultSort: 'name',
    defaultGroup: NO_GROUP,
  };
}
