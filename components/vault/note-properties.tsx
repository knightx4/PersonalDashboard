/**
 * A note's frontmatter, as properties rather than as a code fence.
 *
 * This is the difference between a note that looks like it belongs on the web
 * and one that looks like a file someone dumped into a browser. A naive
 * renderer leaves the `---` block in the body, so every Obsidian note opens
 * with a wall of YAML; Obsidian itself shows it as a small properties table
 * above the text, and so does this.
 *
 * Values are rendered as text, never as markdown. Frontmatter is metadata and
 * a tag called `**urgent**` is a tag, not an instruction to the renderer.
 */
export function NoteProperties({ frontmatter }: { frontmatter: Record<string, unknown> }) {
  const entries = Object.entries(frontmatter).filter(([, value]) => !isEmpty(value));
  if (entries.length === 0) return null;

  return (
    <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-card border border-border bg-canvas px-4 py-3 text-ui">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-medium text-ink-muted">{key}</dt>
          <dd className="min-w-0 break-words text-ink">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
