'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Link from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import type { MarkdownEditorHandle } from '@/components/learn/markdown-editor';
import { cn } from '@/lib/cn';
import { essayParagraphs } from '@/lib/learn/essays/checks';
import {
  linkText,
  paragraphNear,
  quoteSource,
  quoteText,
  STUDY_KIND_LABELS,
  STUDY_PAUSE_MS,
  type StudyItem,
} from '@/lib/learn/essays/study';
import { findEssayStudy, hideEssayStudyItem } from './actions';

export const STUDY_ACTION = 'app/learn/e/[id]/actions.ts#findEssayStudy';

/** Where the panel has got to. */
export type StudyState =
  /** No paragraph long enough to search with yet. */
  | { kind: 'waiting' }
  | { kind: 'searching'; items: StudyItem[] }
  | { kind: 'found'; items: StudyItem[]; searched: boolean; indexed: boolean }
  | { kind: 'failed'; items: StudyItem[]; error: string };

/** The study panel is laptop only (spec, "The writing surface"); a phone never searches. */
const WIDE = '(min-width: 1024px)';

function itemsOf(state: StudyState): StudyItem[] {
  return state.kind === 'waiting' ? [] : state.items;
}

/**
 * The search behind the panel (plan #1863.8): the paragraph the cursor is
 * in, two seconds after the last keystroke or move, and only when that
 * paragraph has changed since the last search. `frozen` is for the gallery,
 * which draws a state and never searches.
 */
export function useEssayStudy(
  essayId: string,
  editor: RefObject<MarkdownEditorHandle | null>,
  initial: StudyState = { kind: 'waiting' },
  frozen = false,
) {
  const [state, setState] = useState<StudyState>(initial);
  const caret = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searched = useRef<string | null>(null);
  const turn = useRef(0);

  const search = useCallback(async () => {
    if (frozen || typeof window === 'undefined' || !window.matchMedia(WIDE).matches) return;
    const doc = editor.current?.doc() ?? '';
    const paragraph = paragraphNear(essayParagraphs(doc), caret.current);
    if (!paragraph) {
      searched.current = null;
      setState({ kind: 'waiting' });
      return;
    }
    if (paragraph.text === searched.current) return;
    searched.current = paragraph.text;
    const mine = ++turn.current;
    setState((now) => ({ kind: 'searching', items: itemsOf(now) }));
    let result: Awaited<ReturnType<typeof findEssayStudy>>;
    try {
      result = await findEssayStudy(essayId, paragraph.text);
    } catch {
      result = {
        ok: false,
        error: 'The connection dropped. Dash will try again when you next pause.',
      };
    }
    if (mine !== turn.current) return;
    if (!result.ok) {
      searched.current = null;
      const error = result.error;
      setState((now) => ({ kind: 'failed', items: itemsOf(now), error }));
      return;
    }
    setState({
      kind: 'found',
      items: result.items,
      searched: result.searched,
      indexed: result.indexed,
    });
  }, [editor, essayId, frozen]);

  const schedule = useCallback(() => {
    if (frozen) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(), STUDY_PAUSE_MS);
  }, [frozen, search]);

  const onCaret = useCallback(
    (pos: number) => {
      caret.current = pos;
      schedule();
    },
    [schedule],
  );

  // The essay as it opened: search once with the paragraph nearest the start.
  useEffect(() => {
    schedule();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  const hide = useCallback(
    async (key: string) => {
      const before = state;
      setState((now) =>
        now.kind === 'waiting'
          ? now
          : { ...now, items: now.items.filter((item) => item.key !== key) },
      );
      const result = await hideEssayStudyItem(essayId, key).catch(() => ({
        ok: false as const,
        error: 'The connection dropped.',
      }));
      if (!result.ok) {
        const error = result.error;
        setState(
          before.kind === 'waiting' ? before : { kind: 'failed', items: before.items, error },
        );
      }
    },
    [essayId, state],
  );

  return { state, onCaret, hide };
}

/** The line under an empty list, saying honestly what was and was not searched. */
function emptyLine(state: Extract<StudyState, { kind: 'found' }>): string {
  if (!state.searched) {
    return 'Dash could not search your notes just now, so only readings, clips, card notes and the learning log were matched. It tries again when you next pause.';
  }
  if (!state.indexed) {
    return 'Nothing you have studied is close enough to this paragraph to show. Passages from your notes are not searchable yet: your vault is still being split into passages, so for now this searches your positions, readings, clips, card notes and learning log.';
  }
  return 'Nothing you have studied is close enough to this paragraph to show.';
}

function StudyRow({
  item,
  onInsert,
  onHide,
}: {
  item: StudyItem;
  onInsert: (text: string, quote?: { name: string }) => void;
  onHide: (key: string) => void;
}) {
  const link = linkText(item);
  const quote = quoteText(item);
  const label = [STUDY_KIND_LABELS[item.kind], item.pinned ? 'Pinned' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <p className="text-small text-ink-muted">{label}</p>
      {item.href ? (
        <Link
          href={item.href}
          className="text-ui font-medium text-ink [overflow-wrap:anywhere] hover:underline"
        >
          {item.title}
        </Link>
      ) : (
        <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">{item.title}</p>
      )}
      {item.context && <p className="line-clamp-2 text-small text-ink-muted">{item.context}</p>}
      {item.sentence && (
        <blockquote className="mt-1 border-l-2 border-border pl-3 text-ui text-ink">{item.sentence}</blockquote>
      )}
      <div className="-ml-2 flex flex-wrap items-center">
        {link && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onInsert(link)}
            aria-label={`Insert a link to ${item.title}`}
          >
            Insert link
          </Button>
        )}
        {quote && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onInsert(quote, { name: quoteSource(item) })}
            aria-label={`Insert the quote from ${item.title}`}
          >
            Insert quote
          </Button>
        )}
        {!item.pinned && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-ink-muted"
            onClick={() => onHide(item.key)}
            aria-label={`Hide ${item.title} for this essay`}
          >
            Hide
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * From your study (plan #1863.8; spec, "From your study"): what you already
 * have that bears on the paragraph you are writing, the brief's pins first.
 * Each item shows the sentence that matched and no score; Insert link puts a
 * `[[link]]` at the cursor, Insert quote the sentence, marked as quoted from
 * its source. Hide drops an item for this essay. Laptop only: on a phone
 * the rail follows the text and this card is not drawn.
 */
export function EssayStudyCard({
  state,
  onInsert,
  onHide,
  className,
}: {
  state: StudyState;
  onInsert: (text: string, quote?: { name: string }) => void;
  onHide: (key: string) => void;
  className?: string;
}) {
  // Before there is a paragraph to match, the card is not drawn (law 1).
  if (state.kind === 'waiting') return null;
  const items = state.items;
  return (
    <Card padding="none" className={cn('hidden lg:block', className)}>
      <CardSection
        title="From your study"
        action={<PaidHint action={STUDY_ACTION} what="Cost of searching with a new paragraph" />}
        meta={state.kind === 'searching' ? 'Searching…' : undefined}
      >
        {items.length > 0 && (
          <ul
            className="flex flex-col divide-y divide-border"
            aria-busy={state.kind === 'searching' || undefined}
          >
            {items.map((item) => (
              <StudyRow key={item.key} item={item} onInsert={onInsert} onHide={onHide} />
            ))}
          </ul>
        )}
        {state.kind === 'found' && items.length === 0 && (
          <p className="text-small text-ink-muted">{emptyLine(state)}</p>
        )}
        {state.kind === 'failed' && (
          <p role="alert" className={cn('text-small text-danger', items.length > 0 && 'mt-3')}>
            {state.error}
          </p>
        )}
        <span role="status" className="sr-only">
          {state.kind === 'found' ? `${items.length} from your study` : ''}
        </span>
      </CardSection>
    </Card>
  );
}
