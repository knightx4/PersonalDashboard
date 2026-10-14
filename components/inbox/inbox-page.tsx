'use client';

import { Fragment, useState, useTransition, type ReactNode } from 'react';
import { BellRing, Inbox as InboxIcon } from 'lucide-react';
import { InboxOverview, inboxAnchor, type InboxCell } from '@/components/inbox/overview';
import { SnoozeMenu } from '@/components/inbox/snooze-menu';
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

/** The words every Inbox uses for putting a row off and turning one down. */
export const INBOX_WORDS = {
  later: 'Later',
  decline: 'Decline',
  bringBack: 'Bring back',
} as const;

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
  /** Later: `choice` is added to the fields (tomorrow, next_week or a day). */
  later?: InboxWrite;
  /** Decline: the row was proposed to you and you turned it down. */
  decline?: InboxWrite;
  /** It was put off, and the day it was put off to has come. */
  back?: boolean;
  /** The workspace's own drawing of the row, in place of the shape's. */
  card?: ReactNode;
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
  return (
    <form
      className="flex flex-wrap items-center gap-2 max-sm:w-full"
      onSubmit={(event) => {
        event.preventDefault();
        if (words.trim()) run(question, { [field]: words.trim() });
      }}
    >
      <Input
        value={words}
        onChange={(event) => setWords(event.target.value)}
        required
        aria-label={`Your answer: ${row.title}`}
        placeholder="Your answer"
        className="w-full max-sm:min-h-11 sm:w-72"
      />
      <Button type="submit" size="sm" pending={pending}>
        Answer
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
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    pending={pending}
                    onClick={() => run(row.decline!)}
                  >
                    {INBOX_WORDS.decline}
                  </Button>
                )}
                {row.later && (
                  <SnoozeMenu label={row.title} onChoose={(choice) => run(row.later!, { choice })} />
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
    <li className="card-pad-x row-pad flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <RowTitle title={row.title} href={row.href} />
        {row.line && <p className="text-small break-words text-ink-muted">{row.line}</p>}
      </div>
      {said.message && !said.error ? (
        <span className="text-small text-positive" role="status">
          {said.message}
        </span>
      ) : (
        row.bringBack && (
          <Button type="button" size="sm" variant="ghost" pending={pending} onClick={() => run(row.bringBack!)}>
            {INBOX_WORDS.bringBack}
          </Button>
        )
      )}
      <FieldError>{said.error}</FieldError>
    </li>
  );
}

export function InboxPage({
  rows,
  later = [],
  empty,
  sectionActions,
  extraCells = [],
  laterOpen = false,
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
  /** Counts for anything the workspace adds below the sections. */
  extraCells?: readonly InboxCell[];
  /** Whether Later starts open; shut on the app's pages. */
  laterOpen?: boolean;
  /** Anything the workspace keeps under the sections, before Later. */
  children?: ReactNode;
}) {
  const sections = INBOX_SECTION_KEYS.map((key) => ({
    key,
    ...INBOX_SECTIONS[key],
    rows: rows.filter((row) => row.section === key),
  })).filter((section) => section.rows.length > 0);

  const cells: InboxCell[] = [
    ...sections.map((section) => ({
      key: section.key,
      title: section.title,
      count: section.rows.length,
      hint: section.hint,
    })),
    ...extraCells,
  ];

  return (
    <div className="space-y-6">
      {cells.length === 0 ? (
        <EmptyState icon={InboxIcon} title={empty.title} description={empty.description} />
      ) : (
        <InboxOverview cells={cells} />
      )}

      {sections.map((section) => (
        <div key={section.key} id={inboxAnchor(section.key)} className="scroll-mt-bar">
          <Group
            fold
            title={
              <>
                {section.title}
                <span className="tabular ml-2 font-normal text-ink-muted">{section.rows.length}</span>
              </>
            }
            action={sectionActions?.[section.key]}
          >
            <ul className={cn(cardVariants(), 'divide-y divide-border')}>
              {section.rows.map((row) =>
                row.card ? <Fragment key={row.ref}>{row.card}</Fragment> : <ShapeRow key={row.ref} row={row} />,
              )}
            </ul>
          </Group>
        </div>
      ))}

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

