import { CommentCount } from '@/components/dev/comment-count';
import { Card } from '@/components/ui/card';
import Link from '@/components/ui/link';
import { Meter } from '@/components/ui/meter';
import { lensLine, meanText, type FieldLevel, type LensSummary } from '@/lib/learn/levels/lenses';

/**
 * The Know page's lenses and fields (docs/LEARN-LEVELS-SPEC.md, "Lenses:
 * subjects and goals"; plan #2138.7).
 *
 * Every subject is a lens, so a subject's row opens its lens and says how far
 * along it is to its targets. A subject whose lens has no topics yet keeps
 * the claims graph's count until it is moved. The learning goals follow as
 * lenses of their own, then each field by the mean level of its topics.
 *
 * The page and the gallery both draw these, so they take rows and read
 * nothing.
 */

export type SubjectLensRow = {
  subjectId: string;
  name: string;
  note: string | null;
  /** The subject's lens; learn 0137 gives every subject one. */
  lens: LensSummary | null;
  /** The claims graph's line, for a lens with nothing on it yet. */
  graphLine: string;
  comments: number;
};

/** The lens's line, in the one measure the list uses; the graph's only for a subject with no lens. */
function subjectLine(row: SubjectLensRow): string {
  return row.lens ? lensLine(row.lens) : row.graphLine;
}

export function SubjectLenses({ rows }: { rows: readonly SubjectLensRow[] }) {
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.subjectId}>
            <Link
              href={row.lens ? `/learn/lens/${row.lens.id}` : `/learn/s/${row.subjectId}`}
              className="card-pad-x row-pad flex min-h-11 items-center justify-between gap-3 hover:bg-sunken"
            >
              <span className="min-w-0">
                <span className="block truncate text-ui font-medium text-ink">{row.name}</span>
                <span className="block truncate text-small text-ink-muted">{subjectLine(row)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <CommentCount count={row.comments} />
                {row.lens && row.lens.total > 0 && <Share lens={row.lens} />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The share held as a figure with a short bar under it. */
function Share({ lens }: { lens: LensSummary }) {
  const percent = Math.round(lens.fraction * 100);
  return (
    <span className="block w-14 text-right">
      <span className="tabular block text-small text-ink">{percent}%</span>
      <Meter value={lens.held} max={lens.total} className="mt-0.5" label={`${lens.held} of ${lens.total} levels held`} />
    </span>
  );
}

export function GoalLenses({
  goals,
  comments,
}: {
  goals: readonly LensSummary[];
  comments: ReadonlyMap<string, number>;
}) {
  if (goals.length === 0) return null;
  return (
    <section aria-labelledby="goal-lenses-heading" className="mt-8">
      <h2 id="goal-lenses-heading" className="mb-2 px-1 text-ui font-semibold text-ink">
        Learning goals
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Link
                href={`/learn/lens/${goal.id}`}
                className="card-pad-x row-pad flex min-h-11 items-center justify-between gap-3 hover:bg-sunken"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ui font-medium text-ink">{goal.name}</span>
                  <span className="block truncate text-small text-ink-muted">{lensLine(goal)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <CommentCount count={comments.get(goal.id) ?? 0} />
                  {goal.total > 0 && <Share lens={goal} />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/**
 * Each field by the mean level of the topics tagged with it, deepest first:
 * depth across a field, not only whether it has been touched. Before any
 * topic is tagged it is one line saying how a field fills.
 */
export function FieldLevels({ fields, failed = false }: { fields: readonly FieldLevel[]; failed?: boolean }) {
  return (
    <section aria-labelledby="field-levels-heading" className="mt-8">
      <h2 id="field-levels-heading" className="mb-2 px-1 text-ui font-semibold text-ink">
        Fields by level
      </h2>
      {failed ? (
        <Card padding="dense">
          <p className="text-ui text-ink-muted">Your topics could not be read, so the fields are missing.</p>
        </Card>
      ) : fields.length === 0 ? (
        <Card padding="dense">
          <p className="text-ui text-ink-muted">
            No topic is tagged with a field yet. A field shows here once an approved topic carries it, at the mean level
            of its topics.
          </p>
        </Card>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {fields.map((field) => (
              <li key={field.fieldId} className="card-pad-x row-pad">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-ui text-ink">{field.name}</span>
                  <span className="tabular shrink-0 text-small text-ink-muted">
                    level {meanText(field.mean)} · {field.topics === 1 ? '1 topic' : `${field.topics} topics`}
                  </span>
                </div>
                <Meter
                  value={field.mean}
                  max={10}
                  className="mt-1.5"
                  label={`${field.name}: mean level ${meanText(field.mean)} of 10`}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
