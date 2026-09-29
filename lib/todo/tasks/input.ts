import { z } from 'zod';

/**
 * What a task is written from, parsed through Zod. Kept apart from write.ts,
 * which is server-only, so a proposal Dash makes in an answer (lib/ask/
 * propose.ts) is checked by the same rule the add bar is.
 */

/** A date field left blank arrives as ''. Treat it as absent, not as invalid. */
const optionalDate = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-03-10').nullable());

const optionalTime = z
  .string()
  .trim()
  .transform((value) => value || null)
  .pipe(z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 14:30').nullable());

export const taskInput = z.object({
  title: z.string().trim().min(1, 'Give it a title.').max(500, 'That title is too long.'),
  body: z
    .string()
    .trim()
    .max(20_000)
    .transform((value) => value || null),
  dueOn: optionalDate,
  dueTime: optionalTime,
  pinned: z.boolean().default(false),
});

export type TaskInput = z.infer<typeof taskInput>;
