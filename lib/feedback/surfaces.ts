/**
 * How a note remembers which surface it was filed against.
 *
 * `/dev/surfaces` stores the surface in `feedback_items.page_path` rather than
 * in a column of its own, because that column's comment in migration 0026
 * already reads "where the user was standing when they hit the problem", and
 * `/preview?s=jobs-pipeline-dense` is exactly that. A `surface` column would
 * have been a second name for one idea.
 *
 * The cost of that choice is a string format three files have to agree on --
 * the action that writes it, the page that reads it back, and the queue tool
 * that sorts by it. Agreeing by copying the same template into each is how the
 * fourth caller gets it subtly wrong and its notes quietly stop grouping. So
 * the format lives here, once, with the parse beside the build.
 */

/** Where a note filed against `id` says the reader was standing. */
export function surfacePath(id: string): string {
  return `/preview?s=${id}`;
}

/**
 * The surface a note was filed against, or null if it came from the app.
 *
 * Deliberately strict: only the exact shape `surfacePath` writes. A loose match
 * would sweep in real `/preview` visits and file them as design notes about a
 * surface nobody named.
 */
export function surfaceOf(pagePath: string | null | undefined): string | null {
  return pagePath?.match(/^\/preview\?s=([\w-]+)$/)?.[1] ?? null;
}

/**
 * Whether a note may be closed, and what its resolution should say.
 *
 * Pure, and here rather than inline in `scripts/notes.ts`, because this is the
 * rule that keeps a design note from being fixed in isolation and it is worth
 * being able to test. The command only prints what this returns.
 *
 * A surface note cannot close without naming the law it broke. That is a
 * forcing function on purpose: the skill already said "be conservative" and was
 * obeyed five times into an app that still read badly, so the guidance that
 * matters is the kind that will not let the command run. You cannot name a law
 * without reading the guide, and you cannot read the guide against one screen
 * without noticing the fix belongs everywhere that law is broken.
 */
export type CloseCheck = { ok: true; resolution: string } | { ok: false; error: string };

export function checkClose(options: {
  pagePath: string | null;
  command: 'done' | 'block' | 'decline';
  note: string;
  law: string | null;
  lawNumbers: readonly number[];
}): CloseCheck {
  const { pagePath, command, note, law, lawNumbers } = options;

  // Only closing as done. Blocking and declining a design note are still
  // legitimate without a law -- neither claims the surface was put right.
  if (!surfaceOf(pagePath) || command !== 'done') return { ok: true, resolution: note };

  const named = lawNumbers.some((n) => String(n) === law);
  if (!named && law !== 'none') {
    return {
      ok: false,
      error:
        'This note was filed against a surface, so closing it needs --law <n>:\n' +
        '  the law it broke, or `--law none` if no law covers it.\n' +
        '  See them with: npx tsx scripts/notes.ts laws\n' +
        '  `--law none` means the guide is missing one — say which in --note,\n' +
        '  and add it to app/dev/ui/laws.ts before closing the batch.',
    };
  }

  // `none` is a real answer and the valuable one: the complaint is sound and no
  // law covers it, so the guide is short a law. Recording it as "Law none —"
  // would read as a law; it is the absence of one, and the note says which.
  return { ok: true, resolution: law === 'none' ? note : `Law ${law} — ${note}` };
}
