export function PageHeader({
  title,
  description,
  actions,
}: {
  /** Node, not string: the role page puts an editable field here. */
  title: React.ReactNode;
  /** Node, not string: several pages put a company link in the subtitle. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
