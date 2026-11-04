'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Check, ExternalLink, LayoutTemplate, LoaderCircle, MessageSquare, Paperclip, SquareTerminal, X } from 'lucide-react';
import { ConversationChat } from '@/components/patterns/conversation';
import { ThreadTurn } from '@/components/thread/thread';
import { CommentBody } from '@/components/dev/comment-body';
import { discardUpload, uploadAttachment } from '@/components/attachments/upload';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { chipVariants } from '@/components/ui/chip';
import { LinkedText } from '@/components/ui/linked-text';
import { ComposeBody, ComposeBox, FieldError, Select } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import Link from '@/components/ui/link';
import { Tooltip } from '@/components/ui/tooltip';
import { ATTACHMENT_ACCEPT, ATTACHMENT_HINT, attachmentSize, type UploadedAttachment } from '@/lib/attachments/rules';
import { cn } from '@/lib/cn';
import { keepCurrent } from '@/lib/share/keep-current';
import { useClockNow } from '@/lib/use-clock-now';
import {
  MOCKUP_COMMENT_MAX,
  SESSION_MESSAGE_MAX,
  THIS_APP_LABEL,
  awaitingReply,
  claudeSessionUrl,
  isPick,
  pickedLinks,
  shownBody,
  sessionThreadPath,
  stateLabel,
  threadTurns,
  workingLine,
  type SessionMessage,
  type SessionThread,
} from '@/lib/core/session-threads-model';
import { CHATS_BACK } from './view';

/**
 * A conversation with a Claude Code session, on Chat's Dash tab (plan
 * #2789.7), in the thread pattern: the project it is on comes first and opens
 * the project, then where the thread stands with "Open in Claude", then the
 * turns oldest first, the session's on the recessed ground, and the box last,
 * closed until it is pressed.
 *
 * - What you send shows at once; a send that fails stays, marked, with Try
 *   again. A new thread is made by its first message, and the page moves to it.
 * - While a reply is to come, a line under the turns says what the session
 *   last reported.
 * - A question shows its options as buttons; one press answers it.
 * - A mockup is a card that opens it, with Pick and Comment under it (plan
 *   #2789.9). Pick tells the session and, on a thread about a plan step, puts
 *   the link on that step; the card then shows Picked. Comment opens a box
 *   whose note goes to the session as a reply on that mockup.
 * - The page re-reads itself while it is open, as a shared page does: every
 *   fifteen seconds while a reply is to come, every minute otherwise.
 */

export type SessionActions = {
  start: (input: {
    projectId: string | null;
    text: string;
    file?: UploadedAttachment | null;
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  send: (input: {
    threadId: string;
    text: string;
    file?: UploadedAttachment | null;
  }) => Promise<{ ok: true; message: SessionMessage } | { ok: false; error: string }>;
  answer: (input: { messageId: string; answer: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  pick: (input: { messageId: string }) => Promise<{ ok: true; step: string | null } | { ok: false; error: string }>;
  comment: (input: { messageId: string; text: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** What the gallery presses with: nothing reaches a server. */
const NO_ACTIONS: SessionActions = {
  start: async () => ({ ok: false, error: 'Not sent in the gallery.' }),
  send: async () => ({ ok: false, error: 'Not sent in the gallery.' }),
  answer: async () => ({ ok: true }),
  pick: async () => ({ ok: true, step: null }),
  comment: async () => ({ ok: true }),
};

export type PendingSend = { id: string; text: string; file: UploadedAttachment | null; failed: string | null };

export type ProjectChoice = { id: string; label: string };

const REPLY_DUE_MS = 15_000;
const QUIET_MS = 60_000;

/** Where the row a thread is about opens: its project's page, or the app's plan. */
function projectHref(projectId: string | null): string {
  return projectId ? `/dev/projects/${encodeURIComponent(projectId)}` : '/dev/plan';
}

export function SessionThreadView({
  thread,
  messages,
  reported = null,
  projects = [],
  projectId: initialProject = null,
  actions = NO_ACTIONS,
  live = true,
  initialBoxOpen = false,
  initialAttachOpen = false,
  initialPending = [],
  initialFile = null,
  initialCommentOn = null,
  now: start,
}: {
  /** Null for a new thread, made by its first message. */
  thread: SessionThread | null;
  messages: readonly SessionMessage[];
  /** What the session last reported on its progress row, for the working line. */
  reported?: string | null;
  /** On a new thread, the projects it can be on. */
  projects?: readonly ProjectChoice[];
  /** On a new thread, the project it starts on. */
  projectId?: string | null;
  actions?: SessionActions;
  /** False in the gallery, which has no server to re-read. */
  live?: boolean;
  /** For the gallery: the box open, the attach sheet open, sends in flight or failed, a file chosen. */
  initialBoxOpen?: boolean;
  initialAttachOpen?: boolean;
  initialPending?: PendingSend[];
  initialFile?: UploadedAttachment | null;
  /** For the gallery: the mockup whose comment box is open. */
  initialCommentOn?: string | null;
  /** The time the page was drawn, until the clock is read. */
  now: number;
}) {
  const router = useRouter();
  const clock = useClockNow();
  // The gallery keeps the time it was drawn at, so its turns read as recent.
  const now = live ? clock || start : start;
  const [projectId, setProjectId] = useState<string | null>(thread?.projectId ?? initialProject);
  const [pending, setPending] = useState<PendingSend[]>(initialPending);
  const [boxOpen, setBoxOpen] = useState(initialBoxOpen || initialAttachOpen);
  const [attachOpen, setAttachOpen] = useState(initialAttachOpen);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<UploadedAttachment | null>(initialFile);
  const [uploading, setUploading] = useState(false);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [answerError, setAnswerError] = useState<{ id: string; error: string } | null>(null);
  const [pickedNow, setPickedNow] = useState<Record<string, string | null>>({});
  const [commentOn, setCommentOn] = useState<string | null>(initialCommentOn);
  const [mockupError, setMockupError] = useState<{ id: string; error: string } | null>(null);
  const [commentSent, setCommentSent] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const boxId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const choose = async (chosen: File) => {
    setUploading(true);
    setFileError(null);
    const result = await uploadAttachment(chosen);
    setUploading(false);
    if ('file' in result) {
      if (file) void discardUpload(file.path);
      setFile(result.file);
    } else setFileError(result.error);
  };

  const remove = (gone: UploadedAttachment) => {
    setFile(null);
    void discardUpload(gone.path);
  };
  const footRef = useRef<HTMLDivElement>(null);

  // Sent messages the server has drawn since are dropped from the pending list.
  const shownIds = new Set(messages.map((m) => m.id));
  const turns = threadTurns(messages);
  const state = thread?.state ?? 'queued';
  const replyDue = pending.some((p) => !p.failed) || awaitingReply(messages);
  const working = thread ? workingLine(state, messages, reported) : null;
  const ended = state === 'ended';
  const label = thread?.projectLabel ?? projects.find((p) => p.id === projectId)?.label ?? THIS_APP_LABEL;
  const openInClaude = claudeSessionUrl(thread?.sessionId ?? null);

  useEffect(() => {
    if (!live || !thread) return;
    return keepCurrent(
      {
        addEventListener: (t, f) => window.addEventListener(t, f),
        removeEventListener: (t, f) => window.removeEventListener(t, f),
        setInterval: (f, ms) => window.setInterval(f, ms),
        clearInterval: (id) => window.clearInterval(id),
      },
      document,
      () => router.refresh(),
      replyDue ? REPLY_DUE_MS : QUIET_MS,
    );
  }, [live, thread, replyDue, router]);

  useEffect(() => {
    footRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending.length]);

  const deliver = (item: PendingSend) => {
    startTransition(async () => {
      if (!thread) {
        const outcome = await actions.start({ projectId, text: item.text, file: item.file });
        if (!outcome.ok) {
          setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: outcome.error } : p)));
          return;
        }
        router.replace(sessionThreadPath(outcome.id));
        router.refresh();
        return;
      }
      const outcome = await actions.send({ threadId: thread.id, text: item.text, file: item.file });
      if (!outcome.ok) {
        setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: outcome.error } : p)));
        return;
      }
      setPending((list) => list.filter((p) => p.id !== item.id));
      router.refresh();
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !file) || uploading || ended) return;
    const item: PendingSend = { id: `pending-${Date.now()}`, text, file, failed: null };
    setPending((list) => [...list, item]);
    setDraft('');
    setFile(null);
    setAttachOpen(false);
    deliver(item);
  };

  const retry = (item: PendingSend) => {
    const again = { ...item, failed: null };
    setPending((list) => list.map((p) => (p.id === item.id ? again : p)));
    deliver(again);
  };

  const answer = (message: SessionMessage, option: string) => {
    setAnswered((map) => ({ ...map, [message.id]: option }));
    setAnswerError(null);
    startTransition(async () => {
      const outcome = await actions.answer({ messageId: message.id, answer: option });
      if (!outcome.ok) {
        setAnswered((map) => {
          const next = { ...map };
          delete next[message.id];
          return next;
        });
        setAnswerError({ id: message.id, error: outcome.error });
        return;
      }
      router.refresh();
    });
  };

  const picked = pickedLinks(messages);
  const titleOf = (url: string | null) => messages.find((m) => m.kind === 'mockup' && m.artifactUrl === url)?.body.trim() || 'the mockup';

  const pick = (message: SessionMessage) => {
    setPickedNow((map) => ({ ...map, [message.id]: null }));
    setMockupError(null);
    startTransition(async () => {
      const outcome = await actions.pick({ messageId: message.id });
      if (!outcome.ok) {
        setPickedNow((map) => {
          const next = { ...map };
          delete next[message.id];
          return next;
        });
        setMockupError({ id: message.id, error: outcome.error });
        return;
      }
      setPickedNow((map) => ({ ...map, [message.id]: outcome.step }));
      router.refresh();
    });
  };

  const comment = (message: SessionMessage, text: string) => {
    setMockupError(null);
    startTransition(async () => {
      const outcome = await actions.comment({ messageId: message.id, text });
      if (!outcome.ok) {
        setMockupError({ id: message.id, error: outcome.error });
        return;
      }
      setCommentSent((list) => [...list, message.id]);
      setCommentOn(null);
      router.refresh();
    });
  };

  const showPending = pending.filter((p) => !shownIds.has(p.id));
  const empty = turns.length === 0 && showPending.length === 0;

  return (
    <ConversationChat title={thread?.title ?? 'New conversation with a session'} back={CHATS_BACK} fill>
      <div className="flex min-h-full flex-col gap-4">
        <header className="min-w-0 space-y-0.5">
          {thread ? (
            <Link
              href={projectHref(thread.projectId)}
              className="inline-flex min-h-11 items-center text-body font-medium text-ink hover:text-accent sm:min-h-0"
            >
              {label}
            </Link>
          ) : (
            <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
          )}
          {thread && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
            <span>{stateLabel(state)}</span>
            {openInClaude && (
              <a
                href={openInClaude}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 font-medium text-accent hover:underline sm:min-h-0"
              >
                Open in Claude
                <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
              </a>
            )}
          </p>
          )}
        </header>

        {empty && <EmptyThread label={label} />}

        {(turns.length > 0 || showPending.length > 0) && (
          <ol className="space-y-3" aria-label="Messages">
            {runsOf(turns).map((run) => (
              <ThreadTurn
                key={run[0].id}
                voice={run[0].author === 'person' ? 'you' : 'dash'}
                name={run[0].author === 'person' ? 'You' : 'Session'}
                at={run[0].createdAt}
                now={now}
                mark={
                  run[0].author === 'person' ? undefined : (
                    <SquareTerminal className="size-3.5 text-ink-ghost" strokeWidth={1.75} aria-hidden />
                  )
                }
              >
                <div className="space-y-2">
                  {run.map((m) => (
                    <Turn
                      key={m.id}
                      message={m}
                      chosen={m.answer ?? answered[m.id] ?? null}
                      canAnswer={!ended}
                      error={answerError?.id === m.id ? answerError.error : null}
                      onAnswer={(option) => answer(m, option)}
                      mockup={{
                        picked: !!m.artifactUrl && (picked.has(m.artifactUrl) || m.id in pickedNow),
                        savedOn: pickedNow[m.id] ?? null,
                        commentOpen: commentOn === m.id,
                        commentSent: commentSent.includes(m.id),
                        error: mockupError?.id === m.id ? mockupError.error : null,
                        aboutTitle: m.author === 'person' && m.artifactUrl ? titleOf(m.artifactUrl) : null,
                        onPick: () => pick(m),
                        onToggleComment: () => setCommentOn((open) => (open === m.id ? null : m.id)),
                        onComment: (text) => comment(m, text),
                      }}
                    />
                  ))}
                </div>
              </ThreadTurn>
            ))}
            {showPending.map((p, i) => (
              <ThreadTurn
                key={p.id}
                voice="you"
                name={i === 0 && turns.at(-1)?.author !== 'person' ? 'You' : undefined}
                now={now}
              >
                <div className={cn('space-y-1', p.failed && 'opacity-60')}>
                  {p.text && (
                    <p className="text-body whitespace-pre-wrap break-words text-ink">
                      <LinkedText text={p.text} refs={false} />
                    </p>
                  )}
                  {p.file && <FileChip name={p.file.name} href={null} />}
                </div>
                {p.failed ? (
                  <p className="text-small text-danger" role="alert">
                    {p.failed}{' '}
                    <button type="button" onClick={() => retry(p)} className="press font-medium text-accent hover:underline">
                      Try again
                    </button>
                  </p>
                ) : (
                  <p className="text-small text-ink-muted">Sending…</p>
                )}
              </ThreadTurn>
            ))}
          </ol>
        )}

        {working && showPending.every((p) => p.failed) && (
          <p className="flex items-center gap-2 text-small text-ink-muted" aria-live="polite">
            <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 break-words">{working}</span>
          </p>
        )}

        <div ref={footRef} className="mt-auto">
          {ended ? (
            <p className="text-small text-ink-muted">This thread has ended. Start a new one to carry on.</p>
          ) : !boxOpen ? (
            <AddTrigger label={thread ? 'Write to the session' : 'Say what to work on'} onClick={() => setBoxOpen(true)} />
          ) : (
            <form ref={formRef} onSubmit={submit}>
              <ComposeBox>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    event.target.value = '';
                    if (chosen) void choose(chosen);
                  }}
                />
                {attachOpen && (
                  <div className="mb-2 space-y-1 border-b border-border pb-2" role="group" aria-label="Attach a file">
                    {file ? (
                      <span className={cn(chipVariants({ tone: 'neutral' }), 'max-w-full gap-1 pr-0.5 font-normal text-ink')}>
                        <span className="min-w-0 truncate">{file.name}</span>
                        <span className="text-ink-muted">{attachmentSize(file.size)}</span>
                        <IconButton size="sm" label={`Remove ${file.name}`} onClick={() => remove(file)}>
                          <X aria-hidden strokeWidth={1.75} />
                        </IconButton>
                      </span>
                    ) : (
                      uploading && <p className="text-small text-ink-muted">Adding the file…</p>
                    )}
                    {fileError && <FieldError>{fileError}</FieldError>}
                    <p className="text-small text-ink-muted">{ATTACHMENT_HINT} The session reads it with your message.</p>
                  </div>
                )}
                {!attachOpen && file && (
                  <div className="mb-2">
                    <FileChip name={file.name} href={null} />
                  </div>
                )}
                <label htmlFor={boxId} className="sr-only">
                  Message to the session
                </label>
                <ComposeBody
                  id={boxId}
                  rows={2}
                  autoFocus={!initialBoxOpen && !initialAttachOpen}
                  maxLength={SESSION_MESSAGE_MAX}
                  placeholder={thread ? 'Write to the session' : `What should the session work on in ${label}?`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && !draft.trim()) {
                      event.preventDefault();
                      setBoxOpen(false);
                      return;
                    }
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    formRef.current?.requestSubmit();
                  }}
                  className="min-h-11 sm:min-h-0"
                />
                <div className="mt-1 flex items-center gap-1">
                  <Tooltip label={attachOpen ? 'Close the file picker' : 'Attach a file'}>
                    <IconButton
                      label={attachOpen ? 'Close the file picker' : 'Attach a file'}
                      active={attachOpen}
                      aria-expanded={attachOpen}
                      pending={uploading}
                      onClick={() => {
                        // The paperclip is the one way to add a file: it opens the
                        // sheet and the file chooser together, and closes the sheet.
                        if (attachOpen) {
                          setAttachOpen(false);
                          return;
                        }
                        setAttachOpen(true);
                        if (!file) fileInput.current?.click();
                      }}
                    >
                      <Paperclip strokeWidth={1.75} aria-hidden />
                    </IconButton>
                  </Tooltip>
                  <Tooltip label="Send" className="ml-auto">
                    <Button
                      type="submit"
                      size="sm"
                      aria-label="Send"
                      className="size-7 shrink-0 px-0 active:brightness-90"
                      disabled={(!draft.trim() && !file) || uploading}
                    >
                      <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
                    </Button>
                  </Tooltip>
                </div>
              </ComposeBox>
            </form>
          )}
        </div>
      </div>
    </ConversationChat>
  );
}

/** On a new thread, which repository the session works on. */
function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: readonly ProjectChoice[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-ui text-ink-muted">
        Working on
      </label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="w-auto min-w-0 border-transparent bg-transparent px-1 font-medium text-ui text-ink hover:bg-sunken max-sm:min-h-11"
      >
        <option value="">{THIS_APP_LABEL}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function EmptyThread({ label }: { label: string }) {
  return (
    <div className="space-y-1 py-6">
      <p className="text-body font-medium text-ink">What should the session work on?</p>
      <p className="max-w-prose text-ui text-ink-muted">
        Say what you want done in {label}. A session starts on its code, writes back here, and asks when it needs you.
        Its mockups and questions show up in this thread.
      </p>
    </div>
  );
}

function FileChip({ name, href }: { name: string; href: string | null }) {
  const inner = (
    <>
      <Paperclip className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 truncate">{name}</span>
    </>
  );
  const chip = cn(chipVariants({ tone: 'neutral' }), 'max-w-full font-normal text-ink');
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cn(chip, 'min-h-11 hover:text-accent sm:min-h-0')}>
      {inner}
    </a>
  ) : (
    <span className={chip}>{inner}</span>
  );
}

/** The turns in runs by one author, each drawn under one name. */
function runsOf(turns: readonly SessionMessage[]): SessionMessage[][] {
  const runs: SessionMessage[][] = [];
  for (const m of turns) {
    const last = runs.at(-1);
    if (last && last[0].author === m.author) last.push(m);
    else runs.push([m]);
  }
  return runs;
}

/** One message: words, a mockup card, or a question with its options. */
function Turn({
  message: m,
  chosen,
  canAnswer,
  error,
  onAnswer,
  mockup,
}: {
  message: SessionMessage;
  chosen: string | null;
  canAnswer: boolean;
  error: string | null;
  onAnswer: (option: string) => void;
  mockup: MockupState;
}) {
  const mine = m.author === 'person';
  return (
    <div className="space-y-1">
      {m.kind === 'mockup' && m.artifactUrl ? (
        <MockupCard message={m} state={mockup} canAct={canAnswer} />
      ) : (
        m.body.trim() && (
          <div className="text-body break-words">
            {mine ? (
              <p className="whitespace-pre-wrap text-ink">
                <LinkedText text={shownBody(m)} refs={false} />
              </p>
            ) : (
              <CommentBody body={m.body} refs="outlines" />
            )}
          </div>
        )
      )}
      {m.attachment && <FileChip name={m.attachment.name} href={m.attachment.href} />}
      {mine && m.artifactUrl && !isPick(m) && (
        <p className="flex items-center gap-1.5 text-small text-ink-muted">
          <LayoutTemplate className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 break-words">{mockup.aboutTitle ? `On \u201c${mockup.aboutTitle}\u201d` : 'On a mockup'}</span>
        </p>
      )}
      {m.kind === 'question' && m.options && (
        <div className="pt-1">
          {chosen ? (
            <p className="flex items-start gap-1.5 text-small text-ink-muted">
              <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0">
                You answered <span className="font-medium text-ink">{chosen}</span>
              </span>
            </p>
          ) : canAnswer ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Answer the question">
              {m.options.map((option) => (
                <Button key={option} type="button" variant="secondary" size="sm" onClick={() => onAnswer(option)} className="max-w-full whitespace-normal text-left max-sm:min-h-11">
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
          {error && <FieldError>{error}</FieldError>}
        </div>
      )}
    </div>
  );
}

/** What a mockup card needs besides the message: whether it is picked, its comment box, and the presses. */
type MockupState = {
  picked: boolean;
  /** The outline of the plan step the pick was just saved on, when it was. */
  savedOn: string | null;
  commentOpen: boolean;
  commentSent: boolean;
  error: string | null;
  /** On your own pick or note about a mockup, that mockup's title. */
  aboutTitle: string | null;
  onPick: () => void;
  onToggleComment: () => void;
  onComment: (text: string) => void;
};

/**
 * A mockup the session drew: the card that opens it, then Pick and Comment.
 * Once picked, a mark takes Pick's place. The comment box stays closed until
 * Comment is pressed.
 */
function MockupCard({ message: m, state, canAct }: { message: SessionMessage; state: MockupState; canAct: boolean }) {
  const [text, setText] = useState('');
  const boxId = useId();
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const note = text.trim();
    if (!note) return;
    state.onComment(note);
    setText('');
  };
  return (
    <div className="space-y-2">
      <a
        href={m.artifactUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={cn(
          cardVariants({ interactive: true }),
          'group/mock flex items-center gap-3 px-3 py-2.5',
          state.picked && 'border-accent',
        )}
      >
        <LayoutTemplate className="size-5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-ui font-medium break-words text-ink group-hover/mock:text-accent">
            {m.body.trim() || 'A mockup'}
          </span>
          <span className="block text-small text-ink-muted">Mockup · opens in a new tab</span>
        </span>
        <ExternalLink className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      </a>
      {(canAct || state.picked) && (
        <div className="flex flex-wrap items-center gap-2">
          {state.picked ? (
            <span className={cn(chipVariants({ tone: 'accent' }), 'max-sm:min-h-11 max-sm:px-3')}>
              <Check strokeWidth={1.75} aria-hidden />
              Picked
            </span>
          ) : (
            canAct && (
              <Button type="button" variant="secondary" size="sm" onClick={state.onPick} className="max-sm:min-h-11">
                Pick
              </Button>
            )
          )}
          {canAct && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              pressed={state.commentOpen}
              onClick={state.onToggleComment}
              className="max-sm:min-h-11"
            >
              <MessageSquare className="size-3.5" strokeWidth={1.75} aria-hidden />
              Comment
            </Button>
          )}
          {state.savedOn && <span className="text-small text-ink-muted">Saved on #{state.savedOn} as its design</span>}
          {state.commentSent && !state.commentOpen && <span className="text-small text-ink-muted">Note sent</span>}
        </div>
      )}
      {state.commentOpen && canAct && (
        <form onSubmit={send}>
          <ComposeBox>
            <label htmlFor={boxId} className="sr-only">
              Your note on this mockup
            </label>
            <ComposeBody
              id={boxId}
              rows={2}
              autoFocus={false}
              maxLength={MOCKUP_COMMENT_MAX}
              placeholder="What would you change about it?"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !text.trim()) {
                  event.preventDefault();
                  state.onToggleComment();
                  return;
                }
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              className="min-h-11 sm:min-h-0"
            />
            <div className="mt-1 flex items-center justify-end">
              <Tooltip label="Send the note">
                <Button
                  type="submit"
                  size="sm"
                  aria-label="Send the note"
                  className="size-7 shrink-0 px-0 active:brightness-90"
                  disabled={!text.trim()}
                >
                  <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
                </Button>
              </Tooltip>
            </div>
          </ComposeBox>
        </form>
      )}
      {state.error && <FieldError>{state.error}</FieldError>}
    </div>
  );
}
