'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ChevronDown, Copy, ExternalLink } from 'lucide-react';
import { FileBody } from '@/components/files/file-body';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button, buttonVariants } from '@/components/ui/button';
import { DashMark } from '@/components/ui/dash-mark';
import { Input } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import { preparedExcerpt } from '@/lib/goals/home';
import {
  SET_ASIDE_CHOICES,
  SET_ASIDE_LABELS,
  canSetAside,
} from '@/lib/goals/set-aside';
import type { TodayItem, TodayKind } from '@/lib/goals/today';
import { askDashStepAction } from './[goalId]/shaping-actions';
import { restoreAsideAction, setAsideAction } from './home-actions';
import { countRhythmAction, setStepStatusAction } from './[goalId]/actions';
import { addGoalComment } from './[goalId]/comment-actions';
import { settleGoalAction } from './actions';
import { answerFlagAction } from './[goalId]/flag-actions';
import { answerGoalQuestion } from './[goalId]/tree-actions';
import { reactToSuggestionAction, recordAttendedAction } from './suggestion-actions';

/**
 * A row of what is on you on the Goals home (plan #1077): everything worth doing,
 * ranked by lib/goals/today.ts, each with one button that does it here or
 * opens where it is done. The rows are Do next and Later (goal-lanes.tsx).
 *
 * A step of yours that Dash prepared something for shows it under the title
 * (withPrepared in lib/goals/today.ts): the first lines, Open for the rest in
 * place, and Copy. The row's one button stays what it was.
 *
 * Anything that is a step can be put aside with Not now (Tomorrow, This
 * weekend, Next week, Next month; lib/goals/set-aside.ts). The row leaves at
 * once, the toast offers Undo, and the step comes back on the day chosen. A
 * step of yours that Dash could prepare also offers Ask Dash, which
 * writes a draft, a script or a checklist onto the step and leaves it yours.
 *
 * Each kind's button is the write that already exists for it:
 *
 * - a question: the answer, as the goal page's question takes it
 * - a Claude step asking you something: a comment on the step, which the next
 *   run reads and unblocks the step from
 * - a flag: the answer, as the goal page's flag takes it
 * - "Did you go?": yes, with a quiet No beside it
 * - a rhythm behind for the period: one more logged against it
 * - a step of yours: done
 * - a suggestion: going, which puts it on Todo, with a quiet Not for me
 * - proposed steps or goals: a link to where they are approved
 * - a goal whose done-when is met: close it, with a quiet Keep it open
 * - a goal nothing has moved on for three weeks: park it, with the same
 *   quiet Keep it open
 *
 * The two quiet second buttons are the answers the old home's lists had, kept
 * so that saying no is not something only the database can do.
 */

type State = { error?: string; message?: string; done?: number };

const initial: State = {};

/** The kinds answered in words, and the field each action reads them from. */
const ANSWER_FIELD: Partial<Record<TodayKind, string>> = {
  question: 'answer',
  ask: 'body',
  flag: 'body',
};

/** The field and value the one button posts, for the kinds whose action reads one. */
const PRIMARY_VALUE: Partial<Record<TodayKind, [string, string]>> = {
  went: ['went', 'yes'],
  step: ['status', 'done'],
  suggestion: ['reaction', 'going'],
  close: ['move', 'close'],
  park: ['move', 'park'],
};

/** The quiet second answer, where the old home offered one. */
const SECOND: Partial<Record<TodayKind, [string, string, string]>> = {
  went: ['went', 'no', 'No'],
  suggestion: ['reaction', 'not_for_me', 'Not for me'],
  close: ['move', 'keep', 'Keep it open'],
  park: ['move', 'keep', 'Keep it open'],
};

/** What each kind says once its button has worked, where the row stays to say it. */
const DONE_WORDS: Partial<Record<TodayKind, string>> = {
  ask: 'Sent. Dash reads it on its next run.',
};

function act(kind: TodayKind, form: FormData): Promise<State> {
  switch (kind) {
    case 'question':
      return answerGoalQuestion({}, form);
    case 'ask':
      return addGoalComment({}, form);
    case 'flag':
      return answerFlagAction({}, form);
    case 'went':
      return recordAttendedAction({}, form);
    case 'rhythm':
      return countRhythmAction(form);
    case 'step':
      return setStepStatusAction(form);
    case 'suggestion':
      return reactToSuggestionAction({}, form);
    case 'close':
    case 'park':
      return settleGoalAction({}, form);
    case 'breakdown':
    case 'plan':
      return Promise.resolve({ error: 'Open it to look it over.' });
  }
}

/** Where a row's title and a link-only button go. */
function hrefFor(item: TodayItem): string {
  switch (item.kind) {
    case 'plan':
      return `/goals/all#area-${item.id}`;
    case 'flag':
      return `/goals/${item.goalId}#flag-${item.id}`;
    case 'question':
    case 'ask':
    case 'step':
    case 'rhythm':
      return `/goals/${item.goalId}#step-${item.id}`;
    default:
      return `/goals/${item.goalId}`;
  }
}

export function TodayRow({
  item,
  rank,
  preparable,
  onAside,
  onHanded,
}: {
  item: TodayItem;
  rank: number | null;
  preparable: boolean;
  /** Hide the row (true) or bring it back (false). */
  onAside: (hidden: boolean) => void;
  /** Dash took it to prepare: the row moves to Dash's lane. */
  onHanded?: () => void;
}) {
  const [state, action, pending] = useActionState(
    (_prev: State, form: FormData) => act(item.kind, form),
    initial,
  );
  const answered = !state.error && (state.message !== undefined || state.done !== undefined);
  const field = ANSWER_FIELD[item.kind];
  const primary = PRIMARY_VALUE[item.kind];
  const second = SECOND[item.kind];
  const href = hrefFor(item);
  const meta = [item.on ? formatDay(item.on) : null, item.detail].filter(Boolean).join(' · ');

  return (
    <li className="card-pad-x row-pad flex items-start gap-3">
      {rank !== null && (
        <span className="tabular w-4 shrink-0 text-body font-semibold text-ink-ghost" aria-hidden>
          {rank}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1 text-body font-semibold break-words text-ink underline-offset-2 hover:underline"
          >
            {item.title}
            <ExternalLink className="mt-1.5 size-3 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
          </a>
        ) : (
          <Link
            href={href}
            className="block text-body font-semibold break-words text-ink underline-offset-2 hover:underline"
          >
            {item.title}
          </Link>
        )}
        <p className="text-small break-words text-ink-muted">
          {meta && <>{meta} · </>}
          <Link
            href={`/goals/${item.goalId}`}
            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {item.goalTitle}
          </Link>
          {item.unblocks > 1 && (
            <span className="text-ink-muted"> · frees {item.unblocks} steps</span>
          )}
        </p>
        {item.prepared && <PreparedDraft text={item.prepared.text} title={item.title} />}
        {answered ? (
          <p className="text-small text-positive" role="status">
            {DONE_WORDS[item.kind] ?? state.message ?? 'Done.'}
          </p>
        ) : item.kind === 'breakdown' || item.kind === 'plan' ? (
          <div className="pt-1">
            <Link href={href} className={buttonVariants({ variant: 'primary' })}>
              {item.action}
            </Link>
          </div>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-2 pt-1">
            <input type="hidden" name="id" value={item.id} />
            {item.startsOn && <input type="hidden" name="startsOn" value={item.startsOn} />}
            {field && (
              <Input
                name={field}
                required
                aria-label={`Your answer: ${item.title}`}
                placeholder="Your answer"
                className="w-full sm:w-64"
              />
            )}
            <Button
              type="submit"
              name={primary?.[0]}
              value={primary?.[1]}
              pending={pending}
            >
              {item.action}
            </Button>
            {second && (
              <Button
                type="submit"
                name={second[0]}
                value={second[1]}
                variant="ghost"
                pending={pending}
              >
                {second[2]}
              </Button>
            )}
            <span className="ml-auto flex items-center gap-1">
              {preparable && <PrepareButton item={item} onHanded={onHanded} />}
              {canSetAside(item.kind) && <NotNow item={item} onAside={onAside} />}
            </span>
            {state.error && <span className="w-full text-small text-danger">{state.error}</span>}
          </form>
        )}
      </div>
    </li>
  );
}

/**
 * What Dash prepared for the step, under its title: the first lines as plain
 * text, Open to read the whole of it here, and Copy, so a draft can be sent
 * from the row without opening the goal.
 */
function PreparedDraft({ text, title }: { text: string; title: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const excerpt = preparedExcerpt(text);
  return (
    <div className="space-y-1.5 rounded-control bg-sunken px-3 py-2">
      <p className="inline-flex items-center gap-1.5 text-small font-semibold text-ink">
        <DashMark size="2xs" tone="brand" decorative />
        Dash’s draft is ready
      </p>
      {open ? (
        <div className="max-w-prose">
          <FileBody markdown={text} compact />
        </div>
      ) : (
        <p className="line-clamp-3 text-small break-words whitespace-pre-line text-ink-muted">
          <LinkedText text={excerpt} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-expanded={open}
          aria-label={open ? `Close Dash’s draft for ${title}` : `Open Dash’s draft for ${title}`}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Close' : 'Open'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Copy Dash’s draft for ${title}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast({ text: 'Copied.' });
            } catch {
              toast({ text: 'It could not be copied. Open it and copy it by hand.' });
            }
          }}
        >
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
          Copy
        </Button>
      </div>
    </div>
  );
}

/**
 * Not now: a menu of days. Choosing one hides the row at once and sets the
 * step's start date; the toast's Undo puts the dates back and the row with
 * them. A refusal brings the row back and says why.
 */
function NotNow({ item, onAside }: { item: TodayItem; onAside: (hidden: boolean) => void }) {
  const toast = useToast();
  const choose = async (choice: string) => {
    onAside(true);
    const form = new FormData();
    form.set('id', item.id);
    form.set('choice', choice);
    const result = await setAsideAction(form);
    if (result.error || !result.before) {
      onAside(false);
      toast({ text: result.error ?? 'It could not be set aside.' });
      return;
    }
    const before = result.before;
    toast({
      text: result.message ?? 'Set aside.',
      undone: 'Put back.',
      undo: async () => {
        const back = new FormData();
        back.set('id', before.id);
        back.set('startsOn', before.startsOn ?? '');
        back.set('dueOn', before.dueOn ?? '');
        const restored = await restoreAsideAction(back);
        if (restored.error) throw new Error(restored.error);
        onAside(false);
      },
    });
  };
  return (
    <ActionMenu
      label={`Not now: ${item.title}`}
      align="end"
      triggerClassName={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-auto')}
      trigger={
        <span className="inline-flex items-center gap-1">
          Not now
          <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden />
        </span>
      }
      items={SET_ASIDE_CHOICES.map((choice) => ({
        id: choice,
        label: SET_ASIDE_LABELS[choice],
        onSelect: () => void choose(choice),
      }))}
    />
  );
}

/**
 * Ask Dash on one step of yours: askDash picks a prepare run for it (plan
 * #1001). It is a button of its own, outside the row's form, so its press
 * never posts the row's answer.
 */
function PrepareButton({ item, onHanded }: { item: TodayItem; onHanded?: () => void }) {
  const toast = useToast();
  const [asked, setAsked] = useState(false);
  const [pending, setPending] = useState(false);
  if (asked) {
    return (
      <span className="inline-flex items-center gap-1 text-small text-ink-muted" role="status">
        <DashMark state="working" activity="writing" size="2xs" tone="brand" decorative />
        Dash is on it
      </span>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      pending={pending}
      title="Dash writes a draft, a script or a checklist onto the step. It stays yours."
      onClick={async () => {
        setPending(true);
        const form = new FormData();
        form.set('id', item.id);
        const result = await askDashStepAction({}, form);
        setPending(false);
        if (result.error) {
          toast({ text: result.error });
          return;
        }
        setAsked(true);
        onHanded?.();
      }}
    >
      <DashMark size="2xs" tone="brand" decorative />
      {pending ? 'Asking…' : 'Ask Dash'}
    </Button>
  );
}
