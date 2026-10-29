import { Globe } from 'lucide-react';
import { ListPage } from '@/components/patterns/list-detail';
import { RowLink } from '@/components/shell/back-link';
import { PageColumn } from '@/components/shell/page-width';
import { PageHeader } from '@/components/shell/page-header';
import { CommentCount } from '@/components/dev/comment-count';
import { ActionMenu } from '@/components/ui/action-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import type { RepositoryListing } from '@/lib/plan/project-add';
import { archiveProject } from './actions';
import { AddProject } from './add-project';

/** What the newest reading of a project's main branch said (plan_main_checks). */
export type ProjectCi = 'passed' | 'failed' | 'running' | 'none' | 'unread';

/** One project as its row on the Projects page draws it. */
export type ProjectRow = {
  id: string;
  label: string;
  /** "owner/name". */
  repository: string;
  ci: ProjectCi;
  /** Steps under the project not yet done or dropped. */
  open: number;
  /** Comments in the project's thread. */
  comments: number;
};

const CI_WORDS: Record<ProjectCi, string> = {
  passed: 'Main passing',
  failed: 'Main failing',
  running: 'Main running',
  none: 'No CI on main',
  unread: 'CI not read yet',
};

/** What the gallery opens, to draw a hidden part of the page. */
export type ProjectsOpen =
  | { part: 'picker'; listing: RepositoryListing; query?: string; error?: string }
  | { part: 'archive'; id: string };

/**
 * Dev's Projects page (plan #2553.5): the repositories Dev builds plan steps
 * in, each with its main branch's CI and how many steps are open, and Add
 * project, which picks another from GitHub. The list-and-detail pattern: the
 * header with its one action, one surface of rows, then the count. Pressing
 * a row opens the project's plan; its menu archives it.
 *
 * The page and the gallery both draw this, so it takes the rows and reads
 * nothing itself.
 */
export function ProjectsView({
  rows,
  open,
}: {
  rows: readonly ProjectRow[];
  open?: ProjectsOpen;
}) {
  const added = rows.map((row) => row.repository.toLowerCase());
  const picker = open?.part === 'picker' ? open : null;
  const add = (variant: 'primary' | 'secondary') => (
    <AddProject
      added={added}
      variant={variant}
      defaultOpen={Boolean(picker)}
      listing={picker?.listing}
      query={picker?.query}
      error={picker?.error ?? null}
    />
  );

  const header = (
    <PageHeader
      subject={sectionSubject('/dev/projects', 'Projects')}
      title="Projects"
      actions={rows.length > 0 ? add('primary') : undefined}
    />
  );

  if (rows.length === 0) {
    return (
      <PageColumn>
        {header}
        <EmptyState
          icon={Globe}
          align="start"
          title="No projects yet"
          description="Add one of your GitHub repositories and it gets its own section on the plan, with its steps built by Dash in that repository."
        >
          {add('secondary')}
        </EmptyState>
      </PageColumn>
    );
  }

  return (
    <ListPage header={header} foot={`${rows.length} ${rows.length === 1 ? 'project' : 'projects'}`}>
      {rows.map((row) => (
        <ProjectListRow key={row.id} row={row} armed={open?.part === 'archive' && open.id === row.id} />
      ))}
    </ListPage>
  );
}

function ProjectListRow({ row, armed }: { row: ProjectRow; armed: boolean }) {
  return (
    <li className="flex items-center pr-2">
      <RowLink
        href={`/dev/projects/${row.id}`}
        className="card-pad-x row-pad flex min-h-11 min-w-0 flex-1 items-center gap-3 hover:bg-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-ink">{row.label}</span>
          <span className="block truncate text-small text-ink-muted">
            {/* The CI state first, so a long repository name is what gets cut. */}
            <span className={cn(row.ci === 'failed' && 'text-danger')}>{CI_WORDS[row.ci]}</span> ·{' '}
            {row.repository}
          </span>
        </span>
        <CommentCount count={row.comments} />
        <span className="tabular shrink-0 text-small text-ink-muted">
          {row.open === 0 ? 'nothing open' : `${row.open} open`}
        </span>
      </RowLink>
      <ActionMenu
        label={`More for ${row.label}`}
        defaultOpen={armed}
        defaultArmed={armed ? 'archive' : undefined}
        // As wide as the menu is placed for, so the confirm ends under the button.
        panelClassName="max-w-45"
        items={[
          {
            id: 'archive',
            label: 'Archive',
            confirm: `Take ${row.label} off the plan? Its steps are kept.`,
            formAction: archiveProject,
            formFields: { id: row.id },
          },
        ]}
      />
    </li>
  );
}
