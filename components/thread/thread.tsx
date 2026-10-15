'use client';

import { useActionState, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import { ArrowUp, AtSign, Check, CircleUser, CornerDownRight, Square, X } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { DashMark, type DashActivity, type DashState } from '@/components/ui/dash-mark';
import { addComment, deleteComment, type CommentActionState } from '@/app/dev/comment-actions';
import { addGoalComment, deleteGoalComment } from '@/app/goals/[goalId]/comment-actions';
import { addRoleComment, deleteRoleComment } from '@/app/jobs/(app)/roles/[id]/comment-actions';
import { addRowComment, deleteRowComment } from '@/app/thread-actions';
import { addReadingComment } from '@/app/learn/r/[id]/actions';
import type { PaidAction } from '@/lib/core/spend/paid-actions';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { CommentBody } from '@/components/dev/comment-body';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Disclosure } from '@/components/ui/disclosure';
import { ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { ReplyCharts } from '@/components/talk/reply-chart';
import { AddFile, type AddFileHandle } from '@/components/attachments/add-file';
import { AskTurnFiles } from '@/components/attachments/ask-turn-files';
import { awaitingDash, SEEN_MESSAGE } from '@/lib/comments/awaiting';
import { MENTION, mentionsDash, withoutMention } from '@/lib/comments/mention';
import { commentWhen, exactTime, shortWhen } from '@/lib/comments/when';
import type { PlanRefTitles } from '@/lib/comments/refs';
import { useClockNow } from '@/lib/use-clock-now';
import type { CommentAuthor, DevComment } from '@/lib/comments/load';
import { answersEvery, threadSubject, type ThreadTarget } from '@/lib/thread/subjects';
import { turnBody, MAX_TURN, type TalkCitation, type TalkTurn } from '@/lib/talk/talk';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/tooltip';
import { menuItemClass, popoverSurface } from '@/components/ui/popover';
import { boxTrigger, replaceTrigger, type BoxTrigger } from '@/lib/talk/box-commands';

/**
 * Every conversation in the app, and the box for adding to it
 * (docs/CORE-AND-DASH-SPEC.md, Part 2; docs/ONE-INTERFACE-SPEC.md, "One
 * thread", plan #1964.3).
 *
 * One component, with a subject or none.
 *
 * With a subject, it is the thread under one row: plan steps and questions,
 * ideas, raises, goals and their steps, files, roles, bug notes, spec
 * sections, takeaways, spec changes, todos, orders, inventory items, saved
 * news stories, vault notes and readings. The row is named by its ref,
 * `schema.table:id` (lib/thread/subjects.ts), and the table in it says which
 * actions take the turns and how Dash takes them: a raise always reaches
 * Dash, everything else answers when tagged.
 *
 * With none, it is a conversation the caller keeps: the Ask Dash sheet and
 * /ask, News' Discuss, Maya in the vault and Learn's cards. The caller's
 * `send` keeps the person's turn, asks for the reply and hands back every
 * turn it wrote.
 *
 * Either way it draws the same thing. Turns oldest first, the author as a
 * glyph in a column of its own and a run by one author headed once; the
 * person's words, the assistant's words and quoted text in the three voices
 * of app/globals.css (`voice-you`, `voice-dash`, `voice-quote`); the box
 * last, closed until it is pressed; and the turn just sent in the thread the
 * instant it is sent, before anything has answered it.
 */

// ---------------------------------------------------------------------------
// The turn, shared by both kinds of thread and by the spec interview.
// ---------------------------------------------------------------------------

/** Whose words a turn holds: yours, or the assistant's (Dash, or Maya in the vault). */
export type ThreadVoice = 'you' | 'dash';

/** The glyph at the head of a run, when the caller has not drawn its own. */
function VoiceMark({ voice }: { voice: ThreadVoice }) {
  if (voice === 'dash') return <DashMark size="2xs" decorative className="text-ink-ghost" />;
  return <CircleUser className="size-3.5 text-ink-ghost" strokeWidth={1.75} aria-hidden />;
}

/**
 * One turn: who, when, and what they said.
 *
 * A row rather than a bubble. The mark sits in a column of its own and the
 * words hang off it, so alignment does the grouping (laws 11 and 13). The
 * assistant's turns take the recessed ground, so they read as his at a glance
 * (taste `no-bare-text`); yours stay on the ground they are written on. A
 * quote inside either is drawn in the quote voice.
 *
 * `name` heads a run; a turn under the head of its run leaves it out, and its
 * strip carries `strip` instead (the row thread's short time).
 */
export function ThreadTurn({
  voice,
  name,
  at,
  now,
  mark,
  strip,
  muted = false,
  trailing,
  children,
  role,
  'aria-live': live,
  'aria-busy': busy,
}: {
  voice: ThreadVoice;
  /** Who wrote it, at the head of a run; left out on a turn grouped under one. */
  name?: string;
  /** When it was written, beside the name. Left out on a turn not yet kept. */
  at?: string;
  now: number;
  /** The glyph at the head of a run, when it is not the voice's own. */
  mark?: React.ReactNode;
  /** What stands in the strip on a grouped turn. */
  strip?: React.ReactNode;
  /** The name in the muted ink: a line standing where an answer is coming. */
  muted?: boolean;
  /** At the end of the row: the row thread's delete. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  role?: React.AriaRole;
  'aria-live'?: 'polite';
  'aria-busy'?: boolean;
}) {
  const head = name !== undefined;
  return (
    <li
      role={role}
      aria-live={live}
      aria-busy={busy}
      className={cn('group flex gap-2', voice === 'dash' ? 'voice-dash -mx-2 px-2 py-1.5' : 'voice-you')}
    >
      <div className="relative flex w-4 shrink-0 justify-center pt-1">
        {head ? (mark ?? <VoiceMark voice={voice} />) : strip}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        {head && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={cn('text-small font-semibold', muted ? 'text-ink-muted' : 'text-ink')}>{name}</span>
            {at && (
              <time dateTime={at} title={exactTime(at)} className="tabular text-small text-ink-muted">
                {commentWhen(at, now)}
              </time>
            )}
          </div>
        )}
        {children}
      </div>
      {trailing}
    </li>
  );
}

/** Words written as markdown: every assistant turn, and a row comment of yours. */
function Words({ body, titles, refs }: { body: string; titles?: PlanRefTitles; refs?: 'outlines' }) {
  return (
    <div className="text-body">
      <CommentBody body={body} titles={titles} refs={refs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The box, shared by both kinds of thread.
// ---------------------------------------------------------------------------

/**
 * One box: the words, what they will reach, and the arrow that sends them.
 * Enter sends and shift-Enter breaks the line, as every chat window does;
 * Escape puts the box away, and so does focus leaving it while it is empty,
 * which is the only way out a phone has. Words already typed keep it open.
 */
function Composer({
  formRef,
  boxRef,
  action,
  onSubmit,
  onClose,
  draft,
  setDraft,
  boxId,
  boxLabel,
  name,
  placeholder,
  maxLength,
  onPaste,
  lead,
  footer,
  hint,
  sendLabel,
  sendDisabled,
  hidden,
  error,
  className,
  over,
  attached,
  onCaret,
  boxProps,
  onKey,
  holdSend = false,
  send,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  boxRef?: React.RefObject<HTMLTextAreaElement | null>;
  action?: (formData: FormData) => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  draft: string;
  setDraft: (draft: string) => void;
  boxId?: string;
  /** Read for the box when nothing on screen names it. */
  boxLabel?: string;
  name?: string;
  placeholder?: string;
  maxLength?: number;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  /** At the left of the line typed on: Dash's tag on a row thread. */
  lead?: React.ReactNode;
  /** Under the words, at the left: what the words reach, or Add a file. */
  footer?: React.ReactNode;
  /** Beside the arrow: what the reply costs. */
  hint?: React.ReactNode;
  sendLabel: string;
  sendDisabled: boolean;
  hidden?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  /** Drawn in the form over the box: the menu an @ or a / opens (plan #1899.5). */
  over?: React.ReactNode;
  /** In the box above the words: the rows added with @. */
  attached?: React.ReactNode;
  /** Heard as the words or the caret move. */
  onCaret?: (box: HTMLTextAreaElement) => void;
  /** More attributes for the words: the menu's aria wiring. */
  boxProps?: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
  /** Heard first on each key; true when it took the key. */
  onKey?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Enter does not send: an answer is on its way and Stop stands in for Send. */
  holdSend?: boolean;
  /** In place of the arrow: Stop while an answer is written. */
  send?: React.ReactNode;
}) {
  return (
    <form
      ref={formRef}
      action={action}
      className={className}
      onSubmit={onSubmit}
      onBlur={(event) => {
        if (draft.trim()) return;
        if (event.currentTarget.contains(event.relatedTarget)) return;
        onClose();
      }}
    >
      {hidden}
      {over}
      <ComposeBox>
        {attached}
        <div className="flex items-start gap-2">
          {lead}
          {boxLabel && boxId && (
            <label htmlFor={boxId} className="sr-only">
              {boxLabel}
            </label>
          )}
          {/* ui-ok: composer-always-open -- Composer is drawn only once its thread's AddTrigger has been pressed. */}
          <ComposeBody
            ref={boxRef}
            id={boxId}
            name={name}
            rows={1}
            className="min-h-11 sm:min-h-0"
            autoFocus
            maxLength={maxLength}
            placeholder={placeholder}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              onCaret?.(event.target);
            }}
            onSelect={onCaret ? (event) => onCaret(event.currentTarget) : undefined}
            {...boxProps}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if (onKey?.(event)) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key !== 'Enter' || event.shiftKey) return;
              // A composing keystroke is part of typing a character, not a
              // send: an IME candidate confirmed with Enter would post the
              // half-written word otherwise.
              if (event.nativeEvent.isComposing) return;
              if (!draft.trim()) return;
              event.preventDefault();
              if (holdSend) return;
              formRef.current?.requestSubmit();
            }}
          />
        </div>
        <div className="mt-1 flex items-end gap-1">
          {footer ?? <span className="flex-1" />}
          <div className="ml-auto flex shrink-0 items-center gap-1 self-center">
            {hint}
            {/* A glyph, so the send control is the same size wherever it
                sits. What a caller's own action is called is what a screen
                reader reads and what the tooltip says. */}
            {send ?? (
              <Button
                type="submit"
                size="sm"
                className="size-7 shrink-0 px-0 active:brightness-90"
                disabled={sendDisabled}
                title={sendLabel}
              >
                <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">{sendLabel}</span>
              </Button>
            )}
          </div>
        </div>
      </ComposeBox>
      {error}
    </form>
  );
}

/** The id a turn not yet written carries, so it can be told apart. */
const PENDING = 'pending';

// ---------------------------------------------------------------------------
// A row's thread.
// ---------------------------------------------------------------------------

/** A server action the thread's forms post to. */
type ThreadAction = (
  prev: CommentActionState,
  formData: FormData,
) => Promise<CommentActionState>;

/**
 * Which actions a row thread's forms post to, and what a reply there costs.
 *
 * Every target writes to the same store, core.conversations under the row's
 * ref (plan #1470, lib/thread/store.ts). The actions still differ in what
 * follows the write: a raise starts a run, a goal's reply can hand on to the
 * goals routine, a role's reply reads the application. Every other target,
 * a file first, takes ROW_STORE, whose reply reads the row from its ref
 * (plan #1441), so a new thread gets Dash's replies with no actions of its own.
 * The cost keys are named here, beside the PaidHint that shows them, which is
 * where lib/core/spend/paid-actions.test.ts looks for them.
 */
export type CommentStore = {
  add: ThreadAction;
  remove: ThreadAction;
  /** The action key the cost hint on a tagged comment prices. */
  paid: PaidAction;
};

/** Ideas, plan steps, raises, bug notes, spec sections, takeaways, spec changes. */
const DEV_STORE: CommentStore = {
  add: addComment,
  remove: deleteComment,
  paid: 'app/dev/comment-actions.ts#addComment',
};

/** Goals and steps, for every signed-in account rather than the owner alone (plan #957). */
const GOALS_STORE: CommentStore = {
  add: addGoalComment,
  remove: deleteGoalComment,
  paid: 'app/goals/[goalId]/comment-actions.ts#addGoalComment',
};

/** A role's thread, with Dash's replies in it (note 89ad8bef). */
const ROLE_STORE: CommentStore = {
  add: addRoleComment,
  remove: deleteRoleComment,
  paid: 'app/jobs/(app)/roles/[id]/comment-actions.ts#addRoleComment',
};

/** Any other row, a file first: Dash's reply reads the row from its ref (plan #1441). */
const ROW_STORE: CommentStore = {
  add: addRowComment,
  remove: deleteRowComment,
  paid: 'app/thread-actions.ts#addRowComment',
};

/**
 * A reading's chat (plan #1876.5): everything written is answered, by Dash
 * reading the reading's text, before the write returns.
 */
const READING_STORE: CommentStore = {
  add: addReadingComment,
  remove: deleteRowComment,
  paid: 'app/learn/r/[id]/actions.ts#addReadingComment',
};

const THREAD_STORES: Record<ThreadTarget, CommentStore> = {
  idea: DEV_STORE,
  step: DEV_STORE,
  raise: DEV_STORE,
  note: DEV_STORE,
  spec: DEV_STORE,
  takeaway: DEV_STORE,
  change: DEV_STORE,
  post: DEV_STORE,
  goal: GOALS_STORE,
  role: ROLE_STORE,
  file: ROW_STORE,
  task: ROW_STORE,
  order: ROW_STORE,
  item: ROW_STORE,
  story: ROW_STORE,
  vault_note: ROW_STORE,
  reading: READING_STORE,
};

function DeleteComment({
  id,
  target,
  remove,
}: {
  id: string;
  target: ThreadTarget;
  remove: ThreadAction;
}) {
  const [state, action, pending] = useActionState(remove, {} as CommentActionState);

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="target" value={target} />
      <FieldError>{state.error}</FieldError>
      <IconButton
        type="submit"
        size="sm"
        label="Delete this comment"
        disabled={pending}
        className="text-ink-ghost disabled:opacity-50"
      >
        <X strokeWidth={1.75} aria-hidden />
      </IconButton>
    </form>
  );
}

/** What the interface calls each of you. The stored author stays `claude`. */
const AUTHOR_NAME: Record<CommentAuthor, string> = { me: 'You', claude: 'Dash' };

/**
 * One comment on a row. Under the head of a run, the strip carries the short
 * time, shown on hover on a laptop, so a comment in the middle of a run can
 * still be dated (#640, #641). Deleting lives on the comment being pointed
 * at rather than standing on every turn.
 */
function Message({
  comment,
  target,
  remove,
  grouped,
  titles,
}: {
  comment: DevComment;
  target: ThreadTarget;
  remove: ThreadAction;
  /** Whether the message above is from the same author, so the header is up already. */
  grouped: boolean;
  /** What each step number in the body is called, for the hover text. */
  titles?: PlanRefTitles;
}) {
  const now = useClockNow();
  // A comment that has not been written yet has no id to delete by, so the
  // control waits for the real row; everything else is drawn as one that landed.
  const unsent = comment.id === PENDING;
  // Whether the comment was already seen when this row first drew. One that
  // was is shown at rest; one that is acknowledged while the thread is open
  // gets the seen mark arriving (plan #1652).
  const [seenAtMount] = useState(Boolean(comment.acknowledgedAt));
  const arrivedSeen = Boolean(comment.acknowledgedAt) && !seenAtMount;

  return (
    <ThreadTurn
      voice={comment.author === 'claude' ? 'dash' : 'you'}
      name={grouped ? undefined : AUTHOR_NAME[comment.author]}
      at={comment.createdAt}
      now={now}
      strip={
        <time
          dateTime={comment.createdAt}
          title={exactTime(comment.createdAt)}
          className="tabular absolute top-1 right-0 whitespace-nowrap text-micro text-ink-ghost transition-opacity duration-quick sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        >
          {shortWhen(comment.createdAt, now)}
        </time>
      }
      trailing={
        unsent ? undefined : (
          <div className="shrink-0 transition-opacity duration-quick sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            <DeleteComment id={comment.id} target={target} remove={remove} />
          </div>
        )
      }
    >
      <Words body={comment.body} titles={titles} />
      {/* Dash read it and had nothing to add (plan #1650): his mark comes to
          rest beside the comment and the seen mark arrives after it, where
          "replying…" would have stood. */}
      {comment.acknowledgedAt && (
        <p className="flex items-center gap-1 text-small text-ink-muted">
          <DashMark size="2xs" decorative className="text-ink-ghost" />
          <Check className={cn('size-4 shrink-0', arrivedSeen && 'dash-seen-in')} strokeWidth={1.75} aria-hidden />
          <span>Seen by Dash</span>
          <time dateTime={comment.acknowledgedAt} title={exactTime(comment.acknowledgedAt)} className="tabular">
            {commentWhen(comment.acknowledgedAt, now)}
          </time>
        </p>
      )}
    </ThreadTurn>
  );
}

/**
 * An action the box sends to instead of `addComment`.
 *
 * One box, whatever it is for. A blocked bug note is the case that needs it:
 * the answer to the question a run left is a comment like any other, and it
 * also puts the note back in the queue, so the write goes through
 * `respondToFeedback` -- #393.
 */
export type CommentSubmit = {
  action: (prev: CommentActionState, formData: FormData) => Promise<CommentActionState>;
  /** What the trigger and the save button say. */
  label: string;
};

type RowThreadProps = {
  /** The row the thread is under, as `schema.table:id`: `threadRef(target, id)` builds one. */
  subject: string;
  /** What has been said so far, oldest first. */
  turns: readonly DevComment[];
  /** What the trigger says when the thread is empty. */
  label?: string;
  /** Where the box writes, when it is not a plain comment. */
  submit?: CommentSubmit;
  placeholder?: string;
  /** What each step number in a comment is called, for the hover text. */
  titles?: PlanRefTitles;
  /**
   * Draw the waiting line with nothing in flight, for the surface gallery:
   * the line is up only for the seconds a tagged comment takes to come back.
   */
  awaitingReply?: boolean;
  /**
   * Open the box with nothing typed in it. The gallery's, and a todo's
   * Comment, which mounts the thread already open (plan #1471).
   */
  composerOpen?: boolean;
  /**
   * Where the comments are written, when not where the subject's table keeps
   * them. Only a goal's flag needs it: a raise whose answer starts a goals run.
   */
  store?: CommentStore;
};

/**
 * A row's thread: your comment is in the thread on the press and the box
 * empties with it, both on the optimistic channel, since the form action
 * runs in a transition that stays pending until a tagged comment has been
 * answered (note ba9b608a). If the write fails the comment goes and the
 * words come back in the box.
 */
function RowThread({
  subject,
  turns: thread,
  label,
  submit,
  placeholder = 'A note on this row, or a question for Dash.',
  awaitingReply = false,
  composerOpen = false,
  titles,
  store,
}: RowThreadProps) {
  const parsed = threadSubject(subject);
  if (!parsed) throw new Error(`Thread: ${subject} is not a row that has a thread`);
  const { target, id } = parsed;
  const writes = store ?? THREAD_STORES[target];
  const [state, action, sending] = useActionState(submit?.action ?? writes.add, {} as CommentActionState);
  const [writing, setWriting] = useState(composerOpen);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  /** Kept only so a failed write can hand the words back rather than lose them. */
  const [sent, setSent] = useState('');
  /** The box has been sent from and is not to be drawn, whatever `writing` still says. */
  const [posted, markPosted] = useOptimistic<boolean, void>(false, () => true);

  const [shown, showOptimistically] = useOptimistic(
    thread,
    (current: readonly DevComment[], body: string): DevComment[] => [
      ...current,
      { id: PENDING, author: 'me', body, createdAt: new Date().toISOString() },
    ],
  );

  // A failed write puts the draft back in the box, adjusted during render.
  const [seenError, setSeenError] = useState<string | undefined>(undefined);
  if (state.error !== seenError) {
    setSeenError(state.error);
    if (state.error && sent) {
      setWriting(true);
      setDraft(sent);
    }
  }

  const now = useClockNow();
  const trigger = submit?.label ?? label ?? (thread.length === 0 ? 'Add a comment' : 'Add another');
  const sendLabel = submit?.label ?? 'Send';
  // A raise is a question put to you, so anything written on one reaches
  // Dash whether or not it carries the tag (#541). Everywhere else the tag does.
  const reaches = (body: string) => answersEvery(target) || mentionsDash(body);
  // Read off the thread rather than off the write being in flight, and held
  // back when the action's own answer is that Dash marked the comment seen.
  const seen = !sending && !state.error && state.message === SEEN_MESSAGE;
  const asking = !seen && (awaitingReply || (!submit && awaitingDash(shown, target, now)));
  const tagged = reaches(draft);
  const last = shown[shown.length - 1];

  const messages = (
    <>
      {shown.length > 0 && (
        <ul className="space-y-2.5">
          {shown.map((comment, index) => (
            <Message
              key={comment.id}
              comment={comment}
              target={target}
              remove={writes.remove}
              grouped={shown[index - 1]?.author === comment.author}
              titles={titles}
            />
          ))}

          {/* Where the answer is going to appear, while it is being written.
              If Dash only acknowledges, this row goes and the mark comes to
              rest under your comment beside the seen mark. */}
          {asking && (
            <ThreadTurn
              voice="dash"
              name="Dash"
              muted
              now={now}
              aria-live="polite"
              mark={<DashMark size="2xs" state="working" activity="reading" decorative className="text-ink-ghost" />}
            >
              <p className="text-body text-ink-muted">
                {!sending && state.message && !state.error
                  ? state.message
                  : target === 'reading'
                    ? 'Reading it and replying…'
                    : 'Reading the row and replying…'}
              </p>
            </ThreadTurn>
          )}
        </ul>
      )}

      {!writing || posted ? (
        <AddTrigger
          label={trigger}
          onClick={() => setWriting(true)}
          // Off while the last comment is still going out, so the box just
          // emptied is not handed back still holding the words.
          disabled={posted}
        />
      ) : (
        <Composer
          formRef={form}
          boxRef={box}
          action={(formData: FormData) => {
            const body = String(formData.get('body') ?? '').trim();
            if (!body) return;
            setSent(body);
            setDraft('');
            setWriting(false);
            markPosted();
            showOptimistically(body);
            action(formData);
          }}
          onClose={() => setWriting(false)}
          draft={draft}
          setDraft={setDraft}
          name="body"
          placeholder={placeholder}
          sendLabel={sendLabel}
          sendDisabled={!draft.trim()}
          hidden={
            <>
              <input type="hidden" name="target" value={target} />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="subject" value={subject} />
            </>
          }
          lead={
            // Dash's own head, at the left of the line you type on, puts the
            // tag in front of what you have written (note 66f5a513). Left
            // off a box writing somewhere else, where nothing reads the tag.
            !submit && (
              <button
                type="button"
                // Keeps the caret where it is: a browser that does not focus a
                // button on click would otherwise close an empty box under it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  // A second press takes the tag back out (note 87a6e077).
                  if (mentionsDash(draft)) {
                    setDraft(withoutMention(draft));
                  } else if (!tagged) {
                    setDraft(draft ? `${MENTION} ${draft}` : `${MENTION} `);
                  }
                  box.current?.focus();
                }}
                aria-pressed={tagged}
                title={
                  mentionsDash(draft)
                    ? `Dash will read this. Press again to take ${MENTION} off.`
                    : tagged
                      ? 'Dash will read this'
                      : `Tag ${MENTION}`
                }
                className={
                  // ui-ok: hand-rolled-box -- the subtle circle is what note 66f5a513 asked for, to set Dash's head apart from the words beside it.
                  'press -ml-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-quick ' +
                  (tagged
                    ? 'border-accent bg-accent-tint text-accent'
                    : 'border-control text-ink-ghost hover:bg-sunken hover:text-ink')
                }
              >
                <DashMark size="2xs" state={tagged ? 'idle' : 'asleep'} tone={tagged ? 'brand' : 'current'} decorative />
                <span className="sr-only">{tagged ? 'Dash will read this' : `Tag ${MENTION}`}</span>
              </button>
            )
          }
          footer={
            // Which of the two things you are writing, while you write it.
            // Left off a box writing somewhere else.
            !submit ? (
              <p className="min-w-0 flex-1 text-small text-ink-muted">
                {target === 'raise'
                  ? 'This is your answer. A session acts on it and replies in the thread.'
                  : target === 'reading'
                    ? 'Dash answers from the reading and its summary, here in the thread.'
                    : tagged
                      ? target === 'file'
                        ? 'Dash will read this and the file, and reply in the thread.'
                        : 'Dash will read this and reply in the thread.'
                      : target === 'file'
                        ? 'A note on the file. Dash reads it before revising the file.'
                        : 'A note on the row. Nothing reads it.'}
              </p>
            ) : undefined
          }
          // Only a tagged comment is answered by Dash; the rest are free.
          hint={!submit && tagged ? <PaidHint action={writes.paid} what="Cost of Dash's reply" align="end" /> : undefined}
          error={<FieldError>{state.error}</FieldError>}
        />
      )}

      {/* The box is closed by the time a failure can arrive, so the reason
          has somewhere of its own to land. */}
      {!writing && state.error && <FieldError>{state.error}</FieldError>}
    </>
  );

  // A row with no comments on it is the button that starts one: a "0
  // comments" heading over it would announce that it has nothing to say.
  if (shown.length === 0) return <div className="space-y-2">{messages}</div>;

  // A thread reads as a thread: a fold whose closed line carries the count and
  // the last turn (law 10), open by default. It sits on the ground of the card
  // it is in, the thread pattern (components/patterns/thread.tsx): the
  // recessed ground belongs to Dash's turns, so it is not also a well round
  // the whole thread.
  return (
    <Disclosure
      className="mt-1"
      defaultOpen
      title={`${shown.length} ${shown.length === 1 ? 'comment' : 'comments'}`}
      meta={last && last.id !== PENDING ? `${AUTHOR_NAME[last.author]}, ${commentWhen(last.createdAt, now)}` : undefined}
    >
      <div className="space-y-2">{messages}</div>
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// A conversation the caller keeps.
// ---------------------------------------------------------------------------

/** What `send` hands back: the turns it kept, and why it stopped short, if it did. */
export type TalkSend = (body: string, files?: UploadedAttachment[]) => Promise<{ turns?: TalkTurn[]; error?: string }>;

/**
 * One choice in the menu over the box (plan #1899.5): a row to add with @,
 * or a command with /. Choosing it puts `insert` where the @ or / and what
 * followed it were, then calls `onPick`.
 */
export type BoxItem = {
  key: string;
  label: string;
  /** What it is, beside the label, quieter. */
  hint?: string | null;
  /** Drawn before the label: the row's workspace mark. */
  mark?: React.ReactNode;
  insert: string;
  onPick?: () => void;
};

/** What the menu over the box offers for what is being typed. */
export type BoxMenu = { label: string; items: readonly BoxItem[]; empty: string };

/**
 * What a turn's `below` can do to the thread (plan #1899.7): the question
 * the turn answered, and the two ways to ask it again. Both add turns at the
 * end, so a thread stays one line of turns.
 */
export type TurnControls = {
  /** The person's turn before this one; null for a turn with none before it. */
  question: string | null;
  /** A reply is being written, so another question would wait. */
  busy: boolean;
  /** Send `body` as a new question now, leaving the box as it is. */
  resend: (body: string) => void;
  /** Open the box with `body` in it, to change and send. */
  edit: (body: string) => void;
};

/**
 * The thread's own turns with any written elsewhere slotted in by time.
 * A check-back that lands while a question is on its way reads that question
 * as already kept, and the answer too if it has been written: those belong to
 * the question still pending here, so they are left out until its answer
 * lands, rather than drawing the question twice (note f94be0c9).
 */
export function withIncoming(own: readonly TalkTurn[], incoming: readonly TalkTurn[] | undefined): readonly TalkTurn[] {
  if (!incoming?.length) return own;
  const have = new Set(own.map((turn) => turn.id));
  let added = incoming.filter((turn) => !have.has(turn.id));
  const pending = own.find((turn) => turn.id === PENDING);
  if (pending) {
    const echo = added.findLastIndex((turn) => turn.role === 'user' && turn.body.trim() === pending.body.trim());
    if (echo !== -1) added = added.filter((turn) => turn.createdAt < added[echo].createdAt);
  }
  if (added.length === 0) return own;
  return [...own, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Who answers in the thread: Dash unless the caller says otherwise. Maya's
 * threads in the vault (plan #1286) pass Maya's name and its owl, so the
 * thread never names Dash for words Maya wrote.
 */
export type TalkAssistant = {
  name: string;
  Mark: React.ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  /** The mark in a state other than idle. Left out, the mark stays as it is. */
  StateMark?: React.ComponentType<{
    state: DashState;
    activity?: DashActivity;
    className?: string;
  }>;
};

/** Dash's own mark at the size of the glyph beside every other turn. */
function DashTurnMark({
  className,
  state = 'idle',
  activity,
}: {
  className?: string;
  state?: DashState;
  activity?: DashActivity;
}) {
  // A reply on its way, or just landed, is Dash as the subject: the brand ramp.
  const tone = state === 'working' || state === 'done' ? 'brand' : 'current';
  return <DashMark size="2xs" state={state} activity={activity} tone={tone} decorative className={className} />;
}

const DASH: TalkAssistant = { name: 'Dash', Mark: DashTurnMark, StateMark: DashTurnMark };

/** How long an answer's mark stays done before it settles back to idle. */
export const DONE_FOR_MS = 1600;

function AssistantMark({
  assistant,
  state = 'idle',
  activity,
}: {
  assistant: TalkAssistant;
  state?: DashState;
  activity?: DashActivity;
}) {
  if (state !== 'idle' && assistant.StateMark) {
    const StateMark = assistant.StateMark;
    // Failed takes the error's colour, so the mark and the words beside it read as one.
    return (
      <StateMark
        state={state}
        activity={activity}
        className={state === 'failed' ? 'size-3.5 text-danger' : 'size-3.5 text-ink-ghost'}
      />
    );
  }
  const Glyph = assistant.Mark;
  return <Glyph className="size-3.5 text-ink-ghost" strokeWidth={1.75} aria-hidden />;
}

// A 44-pixel press on a phone (docs/UI-QUALITY-SPEC.md, R3) from `press-area`,
// which draws no space of its own, so the rows stay one tight list (plan #1708).
const CITED_LINK = `press-area flex min-w-0 text-ui ${linkVariants({ tone: 'inline' })}`;

/**
 * The rows an answer rests on, each a link to where it lives (plan #1090).
 * On a question, the rows the person added with @ (plan #1899.5).
 */
function Cited({ citations, added = false }: { citations: readonly TalkCitation[]; added?: boolean }) {
  const Glyph = added ? AtSign : CornerDownRight;
  return (
    <ul className="pt-1" aria-label={added ? 'Rows you added' : 'What this answer used'}>
      {citations.map((citation) => (
        <li key={`${citation.table}:${citation.ref}`} className="flex min-w-0 items-baseline gap-1.5">
          <Glyph className="size-3 shrink-0 translate-y-0.5 text-ink-ghost" strokeWidth={1.75} aria-hidden />
          {citation.href.startsWith('/') ? (
            <Link href={citation.href} className={CITED_LINK}>
              <span className="min-w-0 truncate">{citation.title}</span>
            </Link>
          ) : (
            // A message Dash searched in Gmail (plan #1316): it opens there, in a new tab.
            <a href={citation.href} target="_blank" rel="noopener noreferrer" className={CITED_LINK}>
              <span className="min-w-0 truncate">{citation.title}</span>
              <span className="sr-only"> (opens in Gmail)</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What a reply in a conversation costs, which the thread prices itself beside
 * the button that opens the box and beside the arrow that sends, the way
 * DashAction prices a press (plan #1964.1).
 */
export type ThreadCost = {
  action: PaidAction;
  /** For a screen reader: "Cost of each answer from Dash". */
  what: string;
  /** Reading the files added so far, which the ledger does not price on its own (plan #1716). */
  plus?: (files: readonly UploadedAttachment[]) => CostEstimate | null;
};

type TalkThreadProps = {
  subject?: undefined;
  /** Unique on the page: the textarea's id is built from it. */
  id: string;
  turns: readonly TalkTurn[];
  send: TalkSend;
  /** What the button that opens the box says. */
  label: string;
  placeholder?: string;
  /** The line shown while the reply is being written. Defaults to "<name> is replying…". */
  waiting?: string;
  /** The line to show in place of the box once the thread has ended, or null while open. */
  closed?: (turns: readonly TalkTurn[]) => string | null;
  /** What a reply costs, priced beside the trigger and the arrow. */
  cost?: ThreadCost;
  /**
   * Beside the arrow in place of the priced hint, for the gallery, which has
   * no ledger to price from.
   */
  sendHint?: (files: readonly UploadedAttachment[]) => React.ReactNode;
  /** Just above the box, or the button that opens it: what goes with a question. */
  above?: React.ReactNode;
  /** Open with the box already up: a surface opened in order to write. */
  startWriting?: boolean;
  /** Send this as soon as the thread appears, once per mount (plan #1090). */
  ask?: string;
  /**
   * The assistant's first words, drawn as his opening turn and kept nowhere:
   * the question News' Discuss opens with.
   */
  opening?: string;
  /**
   * What to draw under a turn: the changes an answer proposed (plan #1190),
   * and the presses under each answer (plan #1899.7), which `thread` lets ask
   * again.
   */
  below?: (turn: TalkTurn, thread: TurnControls) => React.ReactNode;
  /** Who answers: Dash when left out. */
  assistant?: TalkAssistant;
  /** What kind of work the mark shows while a reply is coming. */
  activity?: DashActivity;
  /** Turns written elsewhere since the thread was drawn (plan #1402). */
  incoming?: readonly TalkTurn[];
  /** Under the waiting line while a reply is coming: what Dash is looking up (plan #1438). */
  working?: React.ReactNode;
  /** The reply as far as it has been written, while it is coming (plan #1902). */
  written?: string;
  /** Offer "Add a file" beside Send; the files go to `send` (plan #1715). */
  withFiles?: boolean;
  /** For the preview gallery: the box opens with these words in it. */
  initialDraft?: string;
  /** For the preview gallery: the box opens with these files added. */
  initialFiles?: UploadedAttachment[];
  /** Heard as each question is sent, before the transition that waits for its answer starts. */
  onSubmit?: () => void;
  /**
   * Stops the answer on its way (plan #1899.5). Given, the box stays open
   * once a question is sent and Send turns into Stop while Dash answers; a
   * Stop button stands in for the opener when the box is closed.
   */
  onStop?: () => void;
  /** Hears what the words at the caret ask the menu for: an @ row or a / command, or null. */
  onTrigger?: (trigger: BoxTrigger | null) => void;
  /** The menu over the box for the trigger last heard; null or absent draws none. */
  menu?: BoxMenu | null;
  /** In the box above the words: the rows added with @. */
  attached?: React.ReactNode;
  /** In the box's foot after Add a file: the workspace the lookups are kept to. */
  boxStart?: React.ReactNode;
  /** The rows added with @, drawn on the question as it is sent. */
  questionCitations?: readonly TalkCitation[];
  /**
   * The box is always open and held at the foot of the scrolling pane the
   * thread sits in, as a chat app's is: the Dash page (plan #1899.2). Left
   * out, the box folds back to its opener when emptied and left.
   */
  dock?: boolean;
};

/**
 * A conversation the caller keeps. The question is in the thread on the
 * press; if nothing was kept, it goes and the words come back in the box. If
 * the question was kept and the reply failed, the question stays and the
 * error says why, beside the failed mark.
 */
function TalkThread({
  id,
  turns: initial,
  send,
  label,
  placeholder,
  waiting,
  closed,
  cost,
  sendHint,
  above,
  startWriting = false,
  ask,
  opening,
  below,
  assistant = DASH,
  activity,
  incoming,
  working,
  written = '',
  withFiles = false,
  initialDraft = '',
  initialFiles = [],
  onSubmit,
  onStop,
  onTrigger,
  menu,
  attached,
  boxStart,
  questionCitations,
  dock = false,
}: TalkThreadProps) {
  const [own, setTurns] = useState<TalkTurn[]>([...initial]);
  const turns = useMemo(() => withIncoming(own, incoming), [own, incoming]);
  const [writing, setWriting] = useState(dock || (startWriting && !ask));
  const [draft, setDraft] = useState(initialDraft);
  const [files, setFiles] = useState<UploadedAttachment[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  // Keep the box, and with it Stop, in view while the answer is written
  // beneath the question: a phone's screen is shorter than the lookups and
  // the words that follow, with room under it for the dock (plan #1899.8).
  // Watching the thread's size catches each line as it lands; nothing moves
  // when the box is already in view.
  useEffect(() => {
    const box = form.current;
    if (!sending || !box) return;
    const keep = () => box.scrollIntoView({ block: 'nearest' });
    keep();
    // Again once the question and the working line have been laid out.
    const frame = requestAnimationFrame(() => requestAnimationFrame(keep));
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keep);
    if (box.parentElement) watch?.observe(box.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      watch?.disconnect();
    };
  }, [sending]);
  // A docked thread opens on its latest turn, the way a chat app does.
  useEffect(() => {
    if (dock) form.current?.scrollIntoView({ block: 'end' });
  }, [dock]);
  const adder = useRef<AddFileHandle>(null);
  // What the words at the caret ask the menu for (plan #1899.5), and which
  // of its items is lit. A menu closed with Escape stays closed until the
  // trigger moves on. Words the box opens with are read as typed, caret at
  // their end, so the gallery can draw the menu an @ or a / in them opens.
  const [trigger, setTrigger] = useState<BoxTrigger | null>(() =>
    onTrigger && initialDraft && startWriting && !ask ? boxTrigger(initialDraft, initialDraft.length) : null,
  );
  const [lit, setLit] = useState(0);
  const [shut, setShut] = useState<number | null>(null);
  const noteAt = (value: string, caret: number) => {
    const next = onTrigger ? boxTrigger(value, caret) : null;
    const same =
      trigger?.kind === next?.kind && trigger?.query === next?.query && trigger?.start === next?.start;
    if (same) return;
    if (!next) setShut(null);
    setTrigger(next);
    setLit(0);
    onTrigger?.(next);
  };
  const noteCaret = (box: HTMLTextAreaElement) => noteAt(box.value, box.selectionStart ?? box.value.length);
  useEffect(() => {
    if (!trigger || !initialDraft) return;
    onTrigger?.(trigger);
    const box = document.getElementById(`${id}-talk`);
    if (box instanceof HTMLTextAreaElement) box.setSelectionRange(initialDraft.length, initialDraft.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  const menuOpen = Boolean(trigger && menu && shut !== trigger.start);
  const items = menuOpen && menu ? menu.items : [];
  const choose = (item: BoxItem) => {
    if (!trigger) return;
    const next = replaceTrigger(draft, trigger, item.insert);
    setDraft(next.draft);
    setTrigger(null);
    onTrigger?.(null);
    item.onPick?.();
    requestAnimationFrame(() => {
      const box = document.getElementById(`${id}-talk`);
      if (box instanceof HTMLTextAreaElement) {
        box.focus();
        box.setSelectionRange(next.caret, next.caret);
      }
    });
  };
  const now = useClockNow();
  const ended = sending ? null : (closed?.(turns) ?? null);
  const stopping = sending && Boolean(onStop);

  /**
   * Send a question. From the box, the box empties and its files go with it;
   * a question sent again from under an answer (`fromBox` false) leaves
   * whatever is in the box where it is.
   */
  const submit = (raw: string = draft, fromBox = true) => {
    const checked = turnBody(raw);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    const sentFiles = withFiles && fromBox ? files : [];
    const added = fromBox && questionCitations?.length ? [...questionCitations] : [];
    const question: TalkTurn = {
      id: PENDING,
      role: 'user',
      body: checked.body,
      createdAt: new Date().toISOString(),
      ...(added.length > 0 ? { citations: added } : {}),
      ...(sentFiles.length > 0 ? { files: sentFiles.map((file) => ({ ...file, id: file.path, href: '' })) } : {}),
    };
    // Outside the transition: the question is in the thread on this commit,
    // before anything has been sent.
    setError(null);
    setFailed(null);
    setLanded(null);
    if (fromBox) {
      setDraft('');
      setFiles([]);
      setTrigger(null);
      onTrigger?.(null);
      // With Stop to offer, the box stays where Stop is (plan #1899.5).
      if (!onStop && !dock) setWriting(false);
    }
    setTurns((current) => [...current, question]);
    onSubmit?.();
    startSend(async () => {
      const result = await send(checked.body, sentFiles.length > 0 ? sentFiles : undefined).catch(() => ({
        turns: undefined,
        error: 'That was not sent. Check your connection.',
      }));
      const kept = result.turns ?? [];
      // Inside the transition, so the answer and its done mark replace the
      // working line in one commit.
      startSend(() => {
        setTurns((current) => [...current.filter((turn) => turn.id !== PENDING), ...kept]);
        if (result.error) setFailed(result.error);
        else setLanded(kept.find((turn) => turn.role === 'assistant')?.id ?? null);
        if (kept.length === 0 && fromBox) {
          setDraft(checked.body);
          setFiles(sentFiles);
          setWriting(true);
        }
      });
    });
  };

  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), DONE_FOR_MS);
    return () => clearTimeout(timer);
  }, [landed]);

  const resend = (body: string) => {
    if (sending) return;
    submit(body, false);
  };
  const edit = (body: string) => {
    setError(null);
    setDraft(body);
    setWriting(true);
    // The box may already be open, where autoFocus does not fire again.
    requestAnimationFrame(() => {
      const box = document.getElementById(`${id}-talk`);
      if (box instanceof HTMLTextAreaElement) {
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }
    });
  };
  const questionBefore = (index: number): string | null => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (turns[i].role === 'user') return turns[i].body;
    }
    return null;
  };

  // Once per mount, including under Strict Mode's second effect run: a
  // question sent twice is two answers paid for.
  const asked = useRef(false);
  useEffect(() => {
    if (!ask || asked.current) return;
    asked.current = true;
    submit(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sent once, on arrival
  }, []);

  const mark = (state?: DashState, kind?: DashActivity) => (
    <AssistantMark assistant={assistant} state={state} activity={kind} />
  );

  return (
    <div className={dock ? 'flex flex-1 flex-col gap-2' : 'space-y-2'}>
      {(turns.length > 0 || failed || opening) && (
        <ul className="space-y-2.5">
          {opening && (
            <ThreadTurn voice="dash" name={assistant.name} now={now} mark={mark()}>
              <p className="text-body">{opening}</p>
            </ThreadTurn>
          )}
          {turns.map((turn, index) => {
            const grouped = index === 0 ? Boolean(opening) && turn.role === 'assistant' : turns[index - 1].role === turn.role;
            const mine = turn.role === 'user';
            return (
              <ThreadTurn
                key={turn.id === PENDING ? `${PENDING}-${index}` : turn.id}
                voice={mine ? 'you' : 'dash'}
                name={grouped ? undefined : mine ? 'You' : assistant.name}
                at={turn.id === PENDING ? undefined : turn.createdAt}
                now={now}
                mark={mine ? undefined : mark(turn.id === landed ? 'done' : undefined)}
              >
                {/* An answer is written as markdown (note 7cf4109a); what you
                    typed stays as you typed it. */}
                {mine ? (
                  <p className="text-body whitespace-pre-wrap">
                    <LinkedText text={turn.body} />
                  </p>
                ) : (
                  <Words body={turn.body} refs="outlines" />
                )}
                {turn.files && turn.files.length > 0 && <AskTurnFiles files={turn.files} />}
                {/* A chart Dash drew (plan #1655) sits under the words and above the rows they rest on. */}
                {!mine && <ReplyCharts calls={turn.toolCalls} />}
                {turn.citations && turn.citations.length > 0 && <Cited citations={turn.citations} added={mine} />}
                {turn.id === PENDING
                  ? undefined
                  : below?.(turn, { question: questionBefore(index), busy: sending, resend, edit })}
              </ThreadTurn>
            );
          })}
          {sending && (
            <ThreadTurn
              voice="dash"
              name={assistant.name}
              muted={!written}
              now={now}
              aria-live="polite"
              aria-busy={written ? true : undefined}
              mark={mark('working', written ? 'writing' : activity)}
            >
              {!written && <p className="text-body text-ink-muted">{waiting ?? `${assistant.name} is replying…`}</p>}
              {working}
              {written && <Words body={written} refs="outlines" />}
            </ThreadTurn>
          )}
          {!sending && failed && (
            <ThreadTurn voice="dash" name={assistant.name} now={now} role="alert" mark={mark('failed')}>
              <p className="text-body text-danger">{failed}</p>
            </ThreadTurn>
          )}
        </ul>
      )}

      {!ended && above}

      {ended ? (
        <p className="text-ui text-ink-muted">{ended}</p>
      ) : !writing && !dock ? (
        <div className="flex items-center gap-1">
          <AddTrigger label={label} onClick={() => setWriting(true)} disabled={sending} />
          {stopping ? (
            <Button type="button" variant="secondary" size="sm" onClick={onStop}>
              <Square className="size-3 fill-current" strokeWidth={1.75} aria-hidden />
              Stop
            </Button>
          ) : (
            cost && <PaidHint action={cost.action} what={cost.what} />
          )}
        </div>
      ) : (
        <Composer
          formRef={form}
          className={cn(
            'relative scroll-mb-28',
            // Held at the foot of the pane, after the turns however few:
            // the box is where it is in every chat app, and turns scroll
            // away above it.
            // A phone keeps its own dock at the foot of the screen, so there
            // the box stays in the flow and is scrolled to as before.
            dock && 'mt-auto pb-1 pt-3 min-[720px]:sticky min-[720px]:bottom-0 min-[720px]:z-over-link',
          )}
          onSubmit={(event) => {
            event.preventDefault();
            if (stopping) return;
            submit();
          }}
          onClose={() => {
            if (!dock) setWriting(false);
          }}
          holdSend={stopping}
          attached={attached}
          onCaret={onTrigger ? noteCaret : undefined}
          boxProps={
            onTrigger
              ? {
                  'aria-autocomplete': 'list',
                  'aria-expanded': menuOpen,
                  'aria-controls': menuOpen ? `${id}-menu` : undefined,
                  'aria-activedescendant': items.length > 0 ? `${id}-menu-${lit}` : undefined,
                }
              : undefined
          }
          onKey={(event) => {
            if (!menuOpen || !trigger) return false;
            if (event.key === 'Escape') {
              event.preventDefault();
              setShut(trigger.start);
              return true;
            }
            if (items.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setLit((current) => (current + step + items.length) % items.length);
              return true;
            }
            if (items.length > 0 && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
              if (event.nativeEvent.isComposing) return true;
              event.preventDefault();
              choose(items[Math.min(lit, items.length - 1)]);
              return true;
            }
            return false;
          }}
          over={
            menuOpen &&
            menu && (
              <div
                id={`${id}-menu`}
                role="listbox"
                aria-label={menu.label}
                className={cn(popoverSurface, 'absolute inset-x-0 bottom-full z-overlay mb-1.5 p-1 sm:right-auto sm:w-80')}
              >
                <p className="px-2.5 pb-0.5 pt-1 text-small text-ink-muted">{menu.label}</p>
                {items.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-ui text-ink-muted">{menu.empty}</p>
                ) : (
                  items.map((item, index) => (
                    <button
                      key={item.key}
                      id={`${id}-menu-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === lit}
                      tabIndex={-1}
                      // Kept off the focus path, so the words keep the caret.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setLit(index)}
                      onClick={() => choose(item)}
                      className={cn(menuItemClass(), 'min-h-11 sm:min-h-0', index === lit && 'bg-sunken')}
                    >
                      {item.mark}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hint && <span className="min-w-0 shrink truncate text-small text-ink-muted">{item.hint}</span>}
                    </button>
                  ))
                )}
              </div>
            )
          }
          send={
            stopping ? (
              // Send turns into Stop while Dash answers (plan #1899.5).
              <Tooltip label="Stop the answer and keep what Dash has written">
                <Button
                  type="button"
                  size="sm"
                  className="size-7 shrink-0 px-0 active:brightness-90"
                  aria-label="Stop"
                  onClick={onStop}
                >
                  <Square className="size-3 fill-current" strokeWidth={1.75} aria-hidden />
                </Button>
              </Tooltip>
            ) : undefined
          }
          draft={draft}
          setDraft={setDraft}
          boxId={`${id}-talk`}
          boxLabel={label}
          maxLength={MAX_TURN}
          placeholder={placeholder}
          // A picture copied from anywhere goes in as a file (note 90a05309).
          onPaste={(event) => {
            if (adder.current?.paste(event.clipboardData)) event.preventDefault();
          }}
          footer={
            withFiles || boxStart ? (
              <div className="flex min-w-0 flex-1 items-center gap-1">
                {withFiles && (
                  <AddFile ref={adder} value={files} onChange={setFiles} disabled={sending} onUploadingChange={setUploading} />
                )}
                {boxStart}
              </div>
            ) : undefined
          }
          hint={
            sendHint
              ? sendHint(files)
              : cost && (
                  <PaidHint
                    action={cost.action}
                    plus={cost.plus?.(files)}
                    what={files.length > 0 && cost.plus ? `${cost.what}, reading the files` : cost.what}
                    align="end"
                  />
                )
          }
          sendLabel="Send"
          sendDisabled={!draft.trim() || sending || uploading}
        />
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The one component.
// ---------------------------------------------------------------------------

export type ThreadProps = RowThreadProps | TalkThreadProps;

/**
 * The thread: a row's when given its `subject`, a conversation the caller
 * keeps when given `send` instead.
 */
export function Thread(props: ThreadProps) {
  return props.subject !== undefined ? <RowThread {...props} /> : <TalkThread {...props} />;
}
