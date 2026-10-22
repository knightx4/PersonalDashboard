'use client';

import { Fragment, useState, useTransition, type ReactNode } from 'react';
import { BellRing, Inbox as InboxIcon } from 'lucide-react';
import { inboxAnchor } from '@/components/inbox/overview';
import { INBOX_WORDS } from '@/components/inbox/inbox-words';
import { CloseButton } from '@/components/inbox/close-button';
import { LaterMenu } from '@/components/inbox/snooze-menu';
import { Button, buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Group, SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Input } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { MoveLabel } from '@/components/ui/move-label';
import { cn } from '@/lib/cn';
import type { Move } from '@/lib/core/move';

/**
 * The Inbox, one page for every workspace (plan #1937.4): the count card,
 * then Your actions, Questions for you and To review, then what was put off,
 * shut under Later. Goals and Dev draw it today; each workspace's Inbox after
 * them (plan #1937.5) draws it too.
 *
 * A row is one shape whichever workspace it comes from (`InboxRow`): a ref,
 * a title, a line under it, its move, its verbs, and the question's options
 * where it is a question. Putting a row off is Later, with the menu from
 * lib/core/snooze-days.ts, and turning one down is Decline, the words of
 * docs/ONE-INTERFACE-SPEC.md Part 4, so the two read the same in every room.
 *
 * A row whose workspace already draws something richer than the shape (Dev's
 * raises with their thread, a spec change with its diff, Goals' step with
 * Dash's draft under it) passes that as `card` and keeps every verb it had;
 * the page still places it, counts it and names it by its title.
 */

/** The three sections, in the order the page draws them. */
export const INBOX_SECTION_KEYS = ['actions', 'questions', 'review'] as const;
export type InboxSectionKey = (typeof INBOX_SECTION_KEYS)[number];

/** Each section's heading, and what finishes a row in it, under its count. */
export const INBOX_SECTIONS: Record<InboxSectionKey, { title: string; hint: string }> = {
  actions: { title: 'Your actions', hint: 'To go and do' },
  questions: { title: 'Questions for you', hint: 'Need your answer' },
  review: { title: 'To review', hint: 'Need your yes' },
};

export { INBOX_WORDS };

/** What a verb's write answers: an error to show, or a line to say it worked. */
export type InboxResult = { error?: string; message?: string } | void;

/**
 * A write a row's press makes: a server action taking the form, posted with
 * `fields`. Server pages can pass one, since a server action crosses into
 * the client.
 */
export type InboxWrite = {
  action: (form: FormData) => Promise<InboxResult>;
  fields?: Record<string, string>;
};

/** One press on a row: a link to where it is done, or a write made here. */
export type InboxVerb = {
  label: string;
  /** primary for the row's one main press; the rest are secondary or ghost. */
  tone?: 'primary' | 'secondary' | 'ghost';
} & ({ href: string; write?: never } | { write: InboxWrite; href?: never });

/**
 * A question on a row. With options, each is a press that posts it as the
 * answer; without, a box takes the answer in words.
 */
export type InboxQuestion = InboxWrite & {
  options?: readonly string[];
  /** The field the answer goes in; `answer` unless the action reads another. */
  field?: string;
};

export type InboxRow = {
  /** The row as `schema.table:id`: its key, and what Later snoozes. */
  ref: string;
  section: InboxSectionKey;
  title: string;
  /** One line under the title: where it is from, when it is due. */
  line?: string;
  /** Where the title goes. */
  href?: string;
  move: Move;
  verbs?: readonly InboxVerb[];
  question?: InboxQuestion;
  /** Later, the one menu: `choice` is added to the fields (tomorrow, next_week or a day). */
  later?: InboxWrite;
  /** Decline: the row was proposed to you and you turned it down. */
  decline?: InboxWrite;
  /** It was put off, and the day it was put off to has come. */
  back?: boolean;
  /** The workspace's own drawing of the row, in place of the shape's. */
  card?: ReactNode;
  /** On a page drawn in `groups`, the key of the group the row is listed under. */
  group?: string;
  /**
   * How many things the row stands for in the counts, 1 when unset. A row
   * that opens the rest of a queue the page shows only the head of stands
   * for everything it leaves out (the Jobs Inbox's "Open all in Review").
   */
  stands?: number;
};

/** What a list of rows counts for: each row's `stands`, or 1. */
export function inboxRowsCount(rows: readonly InboxRow[]): number {
  return rows.reduce((sum, row) => sum + (row.stands ?? 1), 0);
}

/**
 * A group on a page that lists its rows by where they come from rather than
 * by section: Home's Inbox, one group per workspace (plan #1937.7).
 */
export type InboxGroup = {
  key: string;
  title: string;
  /** Drawn before the title: the workspace's mark. */
  mark?: ReactNode;
  /** Where the group's own page is, opposite its heading. */
  href?: string;
};

/** A row put off, in the Later fold at the foot. */
export type InboxLaterRow = {
  ref: string;
  title: string;
  /** When it comes back, and where it is from. */
  line?: string;
  href?: string;
  bringBack?: InboxWrite;
  card?: ReactNode;
};

function formOf(fields: Record<string, string> | undefined, extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...extra })) form.set(key, value);
  return form;
}

/** Runs a row's writes, one at a time, keeping the last error or message. */
function useWrites() {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ error?: string; message?: string }>({});
  const run = (write: InboxWrite, extra?: Record<string, string>) =>
    start(async () => {
      try {
        const result = await write.action(formOf(write.fields, extra));
        setSaid(result ?? {});
      } catch {
        setSaid({ error: 'That did not go through. Try again.' });
      }
    });
  return { pending, said, run };
}

function BackMark() {
  return (
    <p className="inline-flex items-center gap-1 text-small font-semibold text-accent">
      <BellRing className="size-3.5" strokeWidth={1.75} aria-hidden />
      Back from Later
    </p>
  );
}

function RowTitle({ title, href }: { title: string; href?: string }) {
  if (!href) return <p className="text-body font-semibold break-words text-ink">{title}</p>;
  return (
    <Link href={href} className="press-area block text-body font-semibold break-words text-ink hover:underline">
      {title}
    </Link>
  );
}

function Answer({ row, run, pending }: { row: InboxRow; run: ReturnType<typeof useWrites>['run']; pending: boolean }) {
  const question = row.question!;
  const field = question.field ?? 'answer';
  const [words, setWords] = useState('');
  const [open, setOpen] = useState(false);
  if (question.options && question.options.length > 0) {
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Answers: ${row.title}`}>
        {question.options.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant="secondary"
            pending={pending}
            onClick={() => run(question, { [field]: option })}
          >
            {option}
          </Button>
        ))}
      </div>
    );
  }
  // Closed to one press until an answer is started (law 14).
  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Answer
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (words.trim()) run(question, { [field]: words.trim() });
      }}
    >
      <Input
        value={words}
        onChange={(event) => setWords(event.target.value)}
        required
        autoFocus
        aria-label={`Your answer: ${row.title}`}
        placeholder="Your answer"
        className="w-full max-sm:min-h-11 sm:w-72"
      />
      <Button type="submit" size="sm" pending={pending}>
        Send
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

/** A row drawn from the shape: title, line, move, answer, verbs, Later and Decline. */
function ShapeRow({ row }: { row: InboxRow }) {
  const { pending, said, run } = useWrites();
  const answered = !said.error && said.message !== undefined;
  // Every row here is on you, so only a move that says something else is drawn.
  const showMove = row.move.state !== 'on_you';
  const verbs = row.verbs ?? [];

  return (
    <li className="card-pad-x row-pad space-y-1.5">
      {row.back && <BackMark />}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <RowTitle title={row.title} href={row.href} />
          {row.line && <p className="text-small break-words text-ink-muted">{row.line}</p>}
        </div>
        {showMove && <MoveLabel move={row.move} />}
      </div>
      {answered ? (
        <p className="text-small text-positive" role="status">
          {said.message}
        </p>
      ) : (
        <>
          {(row.question || verbs.length > 0 || row.later || row.decline) && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {row.question && <Answer row={row} run={run} pending={pending} />}
              {verbs.map((verb) =>
                verb.href ? (
                  <Link
                    key={verb.label}
                    href={verb.href}
                    className={buttonVariants({ variant: verb.tone ?? 'secondary', size: 'sm' })}
                  >
                    {verb.label}
                  </Link>
                ) : (
                  <Button
                    key={verb.label}
                    type="button"
                    size="sm"
                    variant={verb.tone ?? 'secondary'}
                    pending={pending}
                    onClick={() => run(verb.write!)}
                  >
                    {verb.label}
                  </Button>
                ),
              )}
              <span className="ml-auto flex items-center gap-1">
                {row.decline && (
                  <CloseButton lifecycle="declined" pending={pending} onClick={() => run(row.decline!)} />
                )}
                {row.later && (
                  <LaterMenu label={row.title} onChoose={(choice) => run(row.later!, { choice })} />
                )}
              </span>
            </div>
          )}
        </>
      )}
      <FieldError>{said.error}</FieldError>
    </li>
  );
}

function LaterShapeRow({ row }: { row: InboxLaterRow }) {
  const { pending, said, run } = useWrites();
  return (
    <li className="card-pad-x row-pad space-y-0.5">
      {/* The title takes the whole width; Bring back sits on the line under it. */}
      <RowTitle title={row.title} href={row.href} />
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        {row.line && <p className="min-w-0 text-small break-words text-ink-muted">{row.line}</p>}
        {said.message && !said.error ? (
          <span className="ml-auto text-small text-positive" role="status">
            {said.message}
          </span>
        ) : (
          row.bringBack && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto"
              pending={pending}
              onClick={() => run(row.bringBack!)}
            >
              {INBOX_WORDS.bringBack}
            </Button>
          )
        )}
      </div>
      <FieldError>{said.error}</FieldError>
    </li>
  );
}

export function InboxPage({
  rows,
  later = [],
  empty,
  sectionActions,
  alsoWaiting = 0,
  laterOpen = false,
  groups,
  children,
}: {
  /** Everything on you, in the order each section lists it. */
  rows: readonly InboxRow[];
  /** What was put off, for the Later fold. */
  later?: readonly InboxLaterRow[];
  /** What the page says when nothing is on you. */
  empty: { title: string; description: string };
  /** A press that acts on a whole section, opposite its heading (Dev's Approve all). */
  sectionActions?: Partial<Record<InboxSectionKey, ReactNode>>;
  /** Rows the workspace lists under the sections itself, which keep the empty state away. */
  alsoWaiting?: number;
  /** Whether Later starts open; shut on the app's pages. */
  laterOpen?: boolean;
  /**
   * List the rows under these groups, in this order, in place of the three
   * sections; each group's rows keep the sections' order inside it. A row
   * whose `group` names none of them is not drawn.
   */
  groups?: readonly InboxGroup[];
  /** Anything the workspace keeps under the sections, before Later. */
  children?: ReactNode;
}) {
  const bySection = (list: readonly InboxRow[]) =>
    INBOX_SECTION_KEYS.flatMap((key) => list.filter((row) => row.section === key));

  const sections = groups
    ? groups
        .map((group) => ({
          key: group.key,
          title: (
            <span className="inline-flex items-center gap-1.5">
              {group.mark}
              {group.title}
            </span>
          ),
          href: group.href,
          label: group.title,
          rows: bySection(rows.filter((row) => row.group === group.key)),
        }))
        .filter((section) => section.rows.length > 0)
    : INBOX_SECTION_KEYS.map((key) => ({
        key,
        title: INBOX_SECTIONS[key].title as ReactNode,
        href: undefined as string | undefined,
        label: INBOX_SECTIONS[key].title,
        rows: rows.filter((row) => row.section === key),
      })).filter((section) => section.rows.length > 0);

  const total = sections.reduce((sum, section) => sum + inboxRowsCount(section.rows), 0);

  // No count card above the rows: each heading carries its own count, and the
  // total is one line after the last section (the list pattern's count).
  return (
    <div className="space-y-6">
      {total + alsoWaiting === 0 && <EmptyState icon={InboxIcon} title={empty.title} description={empty.description} />}

      {sections.map((section) => (
        <div key={section.key} id={inboxAnchor(section.key)} className="scroll-mt-bar">
          <Group
            fold
            title={
              <>
                {section.title}
                <span className="tabular ml-2 font-normal text-ink-muted">{inboxRowsCount(section.rows)}</span>
              </>
            }
            action={
              section.href ? (
                <Link href={section.href} className="press-area text-small" aria-label={`Open the ${section.label} Inbox`}>
                  Open
                </Link>
              ) : (
                sectionActions?.[section.key as InboxSectionKey]
              )
            }
          >
            <ul className={cn(cardVariants(), 'divide-y divide-border')}>
              {section.rows.map((row) =>
                row.card ? <Fragment key={row.ref}>{row.card}</Fragment> : <ShapeRow key={row.ref} row={row} />,
              )}
            </ul>
          </Group>
        </div>
      ))}

      {total > 0 && (
        <p className="tabular text-small text-ink-muted">
          {total === 1 ? '1 thing waiting on you' : `${total} things waiting on you`}
        </p>
      )}

      {children}

      {/* Shut: these are off you until the day they come back. */}
      {later.length > 0 && (
        <div id={inboxAnchor('later')} className="scroll-mt-bar">
          <SectionFold title={INBOX_WORDS.later} count={later.length} defaultOpen={laterOpen}>
            <ul className={cn(cardVariants(), 'divide-y divide-border')}>
              {later.map((row) =>
                row.card ? (
                  <Fragment key={row.ref}>{row.card}</Fragment>
                ) : (
                  <LaterShapeRow key={row.ref} row={row} />
                ),
              )}
            </ul>
          </SectionFold>
        </div>
      )}
    </div>
  );
}

