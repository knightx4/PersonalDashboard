'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition, type Ref } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { DashAction } from '@/components/ui/dash-action';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineTextarea } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { linkVariants } from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/learn/markdown-editor';
import { cn } from '@/lib/cn';
import { deviceTimeZone, whenAgo } from '@/lib/core/when';
import { EVIDENCE_LABELS } from '@/lib/learn/essays/evidence';
import type { EssayBrief } from '@/lib/learn/essays/model';
import {
  answerBlock,
  assembleDraft,
  notesOf,
  sourceBlock,
  type MapCluster,
  type NoteMap,
} from '@/lib/learn/essays/notebook';
import {
  EVIDENCE_KINDS,
  type ClusterFind,
  type EssayPlan,
  type EvidenceKind,
  type PointEvidence,
  type SourceType,
} from '@/lib/learn/essays/plan';
import { textFragmentUrl } from '@/lib/learn/essays/research';
import {
  changeEssayPlan,
  findClusterEvidence,
  updateNoteMap,
  writeModelDraft,
  type PlanChange,
  type PlanResult,
} from './guide-actions';

const MAP_ACTION = 'app/learn/e/[id]/guide-actions.ts#updateNoteMap';
const FIND_ACTION = 'app/learn/e/[id]/guide-actions.ts#findClusterEvidence';
const DRAFT_ACTION = 'app/learn/e/[id]/guide-actions.ts#writeModelDraft';

/** How long after the last keystroke the notes are saved. */
const NOTES_SAVE_MS = 1_200;

/**
 * The plan behind the notes (LEARN-ESSAYS-SPEC, "Notes first"). A change the
 * person makes shows at once and is sent to the server, one at a time, whose
 * answer replaces it; a press that asks Dash for something waits for the
 * answer. `frozen` is for the gallery, which draws a state and never calls
 * the server.
 */
export function useEssayPlan(essayId: string, initial: EssayPlan, frozen = false) {
  const [plan, setPlan] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  // One write at a time: each reads the stored plan and writes it back, so two
  // at once would lose whichever finished first.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const take = useCallback((result: PlanResult | undefined) => {
    if (!result) {
      setError('The connection dropped. Try again in a moment.');
      return false;
    }
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setError(null);
    setPlan(result.plan);
    return true;
  }, []);

  /** One of the person's own changes, kept straight away and saved behind. */
  const change = useCallback(
    (next: PlanChange, optimistic?: (plan: EssayPlan) => EssayPlan) => {
      if (optimistic) setPlan((now) => optimistic(now));
      if (frozen) return;
      const ticket = ++latest.current;
      queue.current = queue.current.then(async () => {
        const result = await changeEssayPlan(essayId, next).catch(() => undefined);
        // An older answer arriving after a newer change would undo it on screen.
        if (ticket === latest.current) take(result);
        else if (!result || !result.ok) setError(result ? result.error : 'The connection dropped.');
      });
    },
    [essayId, frozen, take],
  );

  /** A press that asks Dash for something and waits for the plan it leaves. */
  const run = useCallback(
    async (call: () => Promise<PlanResult>) => {
      if (frozen) return false;
      const ticket = ++latest.current;
      const done = queue.current.then(() => call().catch(() => undefined));
      queue.current = done;
      const result = await done;
      if (ticket !== latest.current && result?.ok) return true;
      return take(result);
    },
    [frozen, take],
  );

  return { plan, setPlan, change, run, error, setError };
}

export type PlanApi = ReturnType<typeof useEssayPlan>;

/**
 * The notes page: one editor for everything the person thinks about the
 * essay, in any order. It saves itself a moment after they stop typing. An
 * essay that has no notes yet opens on what was already written for it, so
 * nothing from the interview or the old stages is lost.
 */
export function NotesEditor({
  brief,
  api,
  handle,
  autoFocus = false,
}: {
  brief: EssayBrief;
  api: PlanApi;
  handle?: Ref<MarkdownEditorHandle>;
  /** Read once: the page opened on the notes. */
  autoFocus?: boolean;
}) {
  const [initial] = useState(() => notesOf(brief, api.plan));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const change = api.change;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    change({ kind: 'notes', text }, (now) => ({ ...now, notes: text }));
  }, [change]);

  useEffect(() => () => flush(), [flush]);

  return (
    <Card padding="standard">
      <MarkdownEditor
        handle={handle}
        initialDoc={initial}
        label="Your notes"
        placeholder="Write everything you think about this, in any order: claims, examples, doubts, half-sentences, quotes. Dash maps it when you ask."
        autoFocus={autoFocus}
        onChange={(text) => {
          pending.current = text;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, NOTES_SAVE_MS);
        }}
        onSaveNow={flush}
      />
    </Card>
  );
}

function when(iso: string): string {
  return whenAgo(iso, { timeZone: deviceTimeZone() ?? 'UTC' });
}

const SUPPORT: Record<
  MapCluster['support'],
  { label: string; tone: 'neutral' | 'caution' | 'positive' }
> = {
  none: { label: 'nothing behind it yet', tone: 'caution' },
  thin: { label: 'thin', tone: 'neutral' },
  ok: { label: 'supported', tone: 'positive' },
};

/**
 * Dash's map of the notes, beside them (LEARN-ESSAYS-SPEC, "Notes first").
 * Read-only: the person changes it by writing more and pressing Update the
 * map. Claims and clusters show the person's own passages; Dash's words are
 * the cluster names, the gap lines, the tensions' notes and the questions.
 * A question is answered in place and the answer joins the notes. Each
 * cluster can be searched for the rule that applies, evidence, the strongest
 * objection or a real case, and a source is added to the notes with a press.
 */
export function NoteMapCard({
  essayId,
  api,
  append,
}: {
  essayId: string;
  api: PlanApi;
  /** Add text to the end of the notes, through the notes editor so it saves as typing does. */
  append: (text: string) => void;
}) {
  const [updating, start] = useTransition();
  const map = api.plan.noteMap;

  const update = () =>
    start(async () => {
      await api.run(() => updateNoteMap(essayId));
    });

  return (
    <Card padding="none" aria-busy={updating || undefined}>
      <CardSection
        title="Dash’s map of your notes"
        hint={
          map
            ? `From your notes ${when(map.at)}. Write more, then update it; it never changes on its own.`
            : 'What you seem to be arguing, the threads you keep coming back to, and what is missing.'
        }
        action={
          <DashAction
            paid={MAP_ACTION}
            what="Cost of updating the map"
            hintFirst
            type="button"
            size="sm"
            variant={map ? 'secondary' : 'primary'}
            pending={updating}
            disabled={updating}
            onClick={update}
          >
            {updating ? 'Reading your notes…' : map ? 'Update the map' : 'Map my notes'}
          </DashAction>
        }
      >
        {!map && !updating && (
          <p className="text-ui text-ink-muted">
            Write as much as you can first. The map shows your notes back to you in your own
            sentences; to change it, write more.
          </p>
        )}
        {api.error && (
          <p role="alert" className="text-small text-danger">
            {api.error}
          </p>
        )}
        {map && map.claims.length > 0 && (
          <div>
            <p className="text-small font-medium text-ink-muted">What you seem to be arguing</p>
            <ol className="mt-1 flex flex-col gap-1.5">
              {map.claims.map((claim, i) => (
                <li key={claim} className={cn('text-ui text-ink', i === 0 && 'font-medium')}>
                  “{claim}”
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardSection>
      {map && map.questions.length > 0 && (
        <CardSection
          title="Dash asks"
          hint="Answer in your own words; the answer goes into your notes."
        >
          <ul className="flex flex-col gap-3">
            {map.questions.map((question) => (
              <QuestionRow
                key={question}
                question={question}
                onAnswer={(text) => {
                  append(answerBlock(question, text));
                  api.change({ kind: 'answered', question }, (now) =>
                    now.noteMap
                      ? {
                          ...now,
                          noteMap: {
                            ...now.noteMap,
                            questions: now.noteMap.questions.filter((q) => q !== question),
                          },
                        }
                      : now,
                  );
                }}
              />
            ))}
          </ul>
        </CardSection>
      )}
      {map && map.clusters.length > 0 && (
        <CardSection
          title={map.ordered ? 'Your threads, in an order an essay could take' : 'Your threads'}
          hint="Each is something your notes keep returning to, shown in your words."
        >
          <ol className="flex flex-col divide-y divide-border">
            {map.clusters.map((cluster, i) => (
              <ClusterRow
                key={cluster.id}
                essayId={essayId}
                number={map.ordered ? i + 1 : null}
                cluster={cluster}
                found={api.plan.found.find((f) => f.label === cluster.label) ?? null}
                api={api}
                append={append}
              />
            ))}
          </ol>
        </CardSection>
      )}
      {map && map.tensions.length > 0 && (
        <CardSection title="Where your notes pull against each other">
          <ul className="flex flex-col gap-3">
            {map.tensions.map((tension) => (
              <li key={`${tension.a}|${tension.b}`} className="text-ui text-ink">
                <p>“{tension.a}”</p>
                <p className="text-ink-muted">against</p>
                <p>“{tension.b}”</p>
                {tension.note && (
                  <p className="mt-1 text-small text-ink-muted">Dash: {tension.note}</p>
                )}
              </li>
            ))}
          </ul>
        </CardSection>
      )}
    </Card>
  );
}

function QuestionRow({
  question,
  onAnswer,
}: {
  question: string;
  onAnswer: (text: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  return (
    <li className="flex flex-col gap-1">
      <label htmlFor={id} className="text-ui font-medium text-ink">
        {question}
      </label>
      <InlineTextarea
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Your answer, rough is fine"
        className="-mx-1 min-h-11 text-ui text-ink lg:min-h-0"
      />
      {text.trim() && (
        <div>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => {
              onAnswer(text);
              setText('');
            }}
          >
            Add to my notes
          </Button>
        </div>
      )}
    </li>
  );
}

function TypeChip({ type }: { type: SourceType }) {
  const tone =
    type === 'vendor'
      ? 'caution'
      : type === 'regulator' || type === 'standard-setter'
        ? 'accent'
        : 'neutral';
  return (
    <Chip size="sm" tone={tone}>
      {type}
    </Chip>
  );
}

function ClusterRow({
  essayId,
  number,
  cluster,
  found,
  api,
  append,
}: {
  essayId: string;
  number: number | null;
  cluster: MapCluster;
  found: ClusterFind | null;
  api: PlanApi;
  append: (text: string) => void;
}) {
  const [searching, setSearching] = useState<EvidenceKind | null>(null);
  const [empty, setEmpty] = useState(false);
  const [, start] = useTransition();
  const support = SUPPORT[cluster.support];
  const drop = (itemId: string) =>
    api.change({ kind: 'drop-find', label: cluster.label, item: itemId }, (now) => ({
      ...now,
      found: now.found
        .map((f) =>
          f.label === cluster.label ? { ...f, items: f.items.filter((i) => i.id !== itemId) } : f,
        )
        .filter((f) => f.items.length > 0),
    }));

  const find = (kind: EvidenceKind) => {
    setSearching(kind);
    setEmpty(false);
    start(async () => {
      let count = -1;
      await api.run(async () => {
        const result = await findClusterEvidence(essayId, cluster.label, kind);
        if (result.ok) count = result.found;
        return result;
      });
      setEmpty(count === 0);
      setSearching(null);
    });
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="min-w-0 text-ui font-medium text-ink">
          {number !== null && <span className="tabular-nums text-ink-muted">{number}. </span>}
          {cluster.label}
        </p>
        <Chip size="sm" tone={support.tone}>
          {support.label}
        </Chip>
      </div>
      {cluster.gap && <p className="mt-0.5 text-small text-ink-muted">Missing: {cluster.gap}</p>}
      <Disclosure
        title={`In your notes (${cluster.quotes.length})`}
        className="mt-1"
        summaryClassName="text-small"
      >
        <ul className="flex flex-col gap-1.5">
          {cluster.quotes.map((quote) => (
            <li key={quote} className="border-l-2 border-border pl-3 text-small text-ink">
              {quote}
            </li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure title="Find sources for this" className="mt-1" summaryClassName="text-small">
        <div className="flex flex-col items-start gap-1">
          {EVIDENCE_KINDS.map((kind) => (
            <DashAction
              key={kind}
              paid={FIND_ACTION}
              what="Cost of one search"
              type="button"
              size="xs"
              variant="ghost"
              pending={searching === kind}
              disabled={searching !== null}
              onClick={() => find(kind)}
            >
              {EVIDENCE_LABELS[kind]}
            </DashAction>
          ))}
        </div>
      </Disclosure>
      {empty && (
        <p className="mt-1 text-small text-ink-muted">
          Nothing sourced came back. Your own experience may be the evidence here.
        </p>
      )}
      {found && found.items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {found.items.map((item) => (
            <FoundRow
              key={item.id}
              item={item}
              onAdd={() => {
                append(sourceBlock(item));
                drop(item.id);
              }}
              onDrop={() => drop(item.id)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function FoundRow({
  item,
  onAdd,
  onDrop,
}: {
  item: PointEvidence;
  onAdd: () => void;
  onDrop: () => void;
}) {
  return (
    <li className="rounded-control bg-sunken px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-small text-ink-muted">
          {EVIDENCE_LABELS[item.kind]} · <TypeChip type={item.sourceType} />
        </p>
        <IconButton size="sm" label="Drop this source" onClick={onDrop}>
          <X strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>
      {item.title && <p className="text-ui font-medium text-ink">{item.title}</p>}
      <p className="text-small text-ink">
        {item.summary}{' '}
        <a
          href={textFragmentUrl(item.url, item.quote)}
          target="_blank"
          rel="noreferrer"
          title={item.sourceTitle}
          className={linkVariants()}
        >
          {item.domain || item.sourceTitle}
        </a>
      </p>
      <Button type="button" size="xs" variant="secondary" className="mt-1" onClick={onAdd}>
        Add the quote to my notes
      </Button>
    </li>
  );
}

/**
 * The two ways from the notes to a draft (LEARN-ESSAYS-SPEC, "Notes first").
 * Assemble lays the person's own passages out in the map's order under
 * Dash's headings, with the gaps marked; it replaces the draft, so on a draft
 * with words in it the press asks once more. The model draft is Dash's essay
 * from the notes, kept beside the draft and never put into it.
 */
export function FromNotesCard({
  essayId,
  api,
  map,
  draftWords,
  title,
  model,
  onAssemble,
}: {
  essayId: string;
  api: PlanApi;
  map: NoteMap | null;
  draftWords: number;
  title: string;
  model: string;
  onAssemble: (draft: { text: string; marks: ReturnType<typeof assembleDraft>['marks'] }) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [drafting, start] = useTransition();

  const assemble = () => {
    if (!map) return;
    if (draftWords > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onAssemble(assembleDraft(map, title, model));
  };

  return (
    <Card padding="none" aria-busy={drafting || undefined}>
      <CardSection title="From your notes">
        <p className="text-small text-ink-muted">
          Assemble lays your own sentences out in the map’s order under headings, with the gaps
          marked. Every word but the headings and gap lines is yours.
        </p>
        <Button
          type="button"
          size="sm"
          variant={confirming ? 'danger' : 'secondary'}
          className="mt-2"
          disabled={!map}
          onClick={assemble}
          title={map ? undefined : 'Map your notes first'}
        >
          {confirming ? 'Replace my draft with it' : 'Assemble a draft'}
        </Button>
        {confirming && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2 ml-1"
            onClick={() => setConfirming(false)}
          >
            Keep my draft
          </Button>
        )}
        <p className="mt-3 text-small text-ink-muted">
          A model draft is Dash’s own essay from your notes, to argue with. It stays beside your
          draft and never goes into it.
        </p>
        <DashAction
          paid={DRAFT_ACTION}
          what="Cost of a model draft"
          type="button"
          size="sm"
          variant="secondary"
          wrapperClassName="mt-2"
          pending={drafting}
          disabled={drafting}
          onClick={() =>
            start(async () => {
              await api.run(() => writeModelDraft(essayId));
            })
          }
        >
          {drafting ? 'Writing…' : api.plan.modelDraft ? 'Write it again' : 'Write a model draft'}
        </DashAction>
        {api.error && (
          <p role="alert" className="mt-2 text-small text-danger">
            {api.error}
          </p>
        )}
      </CardSection>
    </Card>
  );
}

/** Dash's model draft, under the person's draft, folded, and labelled as Dash's. */
export function ModelDraftPanel({ draft }: { draft: { text: string; at: string } | null }) {
  if (!draft) return null;
  return (
    <Card padding="standard" className="mt-4">
      <Disclosure title="Dash’s model draft" meta={`not part of your essay · ${when(draft.at)}`}>
        <div className="flex max-w-prose flex-col gap-3 text-body text-ink">
          {draft.text.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-line">
              <LinkedText text={para} refs={false} />
            </p>
          ))}
        </div>
      </Disclosure>
    </Card>
  );
}
