'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ExternalLink, List, Plus, X } from 'lucide-react';
import { CommentCount } from '@/components/dev/comment-count';
import { LinkPicker, type LinkChoice } from '@/components/todo/link-picker';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button, buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Input } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import Link from '@/components/ui/link';
import { scrim } from '@/components/ui/popover';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { chipLine, chipOf, type ListRowView, type ListView } from '@/lib/goals/goal-lists';
import { isListedKind, type ListedKind } from '@/lib/goals/links';
import { linkRowAction, type LinkActionState } from './link-actions';
import {
  addGoalListAction,
  addListRowAction,
  confirmListRowAction,
  type ListActionState,
} from './list-actions';

/**
 * A goal's lists on its page (plan #2330.3): one chip per list on the
 * done-when's card, each saying how many rows it has and what stands out, and
 * pressing one opens the list in a panel over the page. The panel holds the
 * list's name, a count line with the add button, the rows and a fold for the
 * rows ruled out. It closes from its close button, Escape or a press outside.
 *
 * A goal's own list takes a pasted link, read for its name, picture and price
 * as a draft to confirm, or a typed name. A linked list takes a reading, a
 * saved product or a contact found by search, and its rows open their own
 * pages in the workspaces that keep them.
 *
 * The views over a list (Compare, Gallery, a calendar, a map) are #2330.4's;
 * the panel draws the table, which every list has.
 */

/** What the gallery opens on. Nothing in the app passes it. */
export type ListsSeam = {
  /** A list's key, drawn with its panel open. */
  open?: string;
  /** The add box's error or note, as a refused or half-read link leaves it. */
  addState?: ListActionState;
  /** What the add box holds with `addState`, as the person typed it. */
  typed?: string;
  /** The add box mid-add, as a link is being read. */
  adding?: string;
  /** The ruled-out fold, drawn open. */
  ruledOutOpen?: boolean;
  /** The new-list form, drawn open. */
  naming?: boolean;
};

export function GoalListChips({
  goalId,
  goalTitle,
  lists,
  canAdd = true,
  seam,
}: {
  goalId: string;
  goalTitle: string;
  lists: ListView[];
  /** Whether a list can be started here: an open goal. */
  canAdd?: boolean;
  seam?: ListsSeam;
}) {
  const [open, setOpen] = useState<string | null>(seam?.open ?? null);
  const [naming, setNaming] = useState(seam?.naming ?? false);
  const opener = useRef<HTMLButtonElement | null>(null);
  // Where the panel is drawn: inside the element naming the workspace, found
  // from the chip pressed (or the row, for a panel the gallery opens).
  const [host, setHost] = useState<Element | null>(null);
  const shown = lists.find((list) => list.key === open) ?? null;
  const hostOf = (el: Element) => el.closest('[data-workspace]') ?? document.body;
  if (lists.length === 0 && !naming) return null;

  return (
    <div
      ref={(el) => {
        if (el && open && !host) setHost(hostOf(el));
      }}
      className="space-y-2"
    >
      <div role="group" aria-label="Lists" className="flex flex-wrap items-center gap-2">
        {lists.map((list) => (
          <ListChipButton
            key={list.key}
            list={list}
            expanded={open === list.key}
            onOpen={(button) => {
              opener.current = button;
              setHost(hostOf(button));
              setOpen(list.key);
            }}
          />
        ))}
        {canAdd && !naming && (
          <AddTrigger label="New list" onClick={() => setNaming(true)} className="ml-0" />
        )}
      </div>
      {naming && <NewListForm goalId={goalId} onClose={() => setNaming(false)} />}
      {shown && host && (
        <ListPanel
          goalId={goalId}
          goalTitle={goalTitle}
          list={shown}
          seam={seam}
          host={host}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** One list's chip: up to two pictures or the list mark, the name, then the count and what stands out. */
function ListChipButton({
  list,
  expanded,
  onOpen,
}: {
  list: ListView;
  expanded: boolean;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const chip = chipOf(list);
  const line = chipLine(chip);
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'max-w-full justify-start bg-sunken pl-1.5 pr-2.5 font-normal text-ink hover:text-ink',
      )}
    >
      {chip.pictures.length > 0 ? (
        <span className="flex shrink-0 gap-0.5" aria-hidden>
          {chip.pictures.slice(0, 2).map((src) => (
            <span key={src} className="size-6 overflow-hidden rounded-control bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary shop CDNs */}
              <img src={src} alt="" className="size-full object-cover" />
            </span>
          ))}
        </span>
      ) : (
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-control bg-surface text-ink-muted"
          aria-hidden
        >
          <List className="size-3.5" strokeWidth={1.75} />
        </span>
      )}
      <span className="max-w-48 shrink-0 truncate font-medium">{chip.name}</span>
      {line && (
        <span className="tabular min-w-0 max-w-56 truncate text-small text-ink-muted">{line}</span>
      )}
      <ChevronRight className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/**
 * The list in a panel over the page: from the right on a laptop, from the
 * foot on a phone. Drawn inside the nearest element that names the workspace,
 * so the panel keeps the page's accent.
 */
function ListPanel({
  goalId,
  goalTitle,
  list,
  seam,
  host,
  onClose,
}: {
  goalId: string;
  goalTitle: string;
  list: ListView;
  seam?: ListsSeam;
  host: Element;
  onClose: () => void;
}) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-overlay">
      <button
        type="button"
        aria-label={`Close ${list.name}`}
        tabIndex={-1}
        onClick={onClose}
        className={scrim}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className={cn(
          'rise-in absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-card border-t border-border bg-raised shadow-lg',
          'md:inset-y-3 md:left-auto md:right-3 md:max-h-none md:w-[min(40rem,calc(100vw-1.5rem))] md:rounded-card md:border',
        )}
      >
        <div className="flex items-start gap-3 px-4 pt-4 pb-2 md:px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-small text-ink-muted">On {goalTitle}</p>
            <h2 id={`${id}-title`} className="truncate text-title font-semibold text-ink">
              {list.name}
            </h2>
          </div>
          <IconButton ref={closeRef} label={`Close ${list.name}`} onClick={onClose}>
            <X strokeWidth={1.75} aria-hidden />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 md:px-5">
          <ListBody goalId={goalId} list={list} seam={seam} className="flex-1" />
        </div>
      </aside>
    </div>,
    host,
  );
}

/**
 * A list's count line, rows and ruled-out fold: the panel's body, and the
 * whole of a list's own tab on a goal with three lists or more. The add box
 * stays shut behind one button until it is wanted, so an open field never
 * repeats what the empty line says.
 */
export function ListBody({
  goalId,
  list,
  seam,
  className,
}: {
  goalId: string;
  list: ListView;
  seam?: ListsSeam;
  /** In the panel, `flex-1`, so the ruled-out fold sits at the panel's foot. */
  className?: string;
}) {
  const [adding, setAdding] = useState<string | null>(seam?.adding ?? null);
  const [boxOpen, setBoxOpen] = useState(Boolean(seam?.addState || seam?.adding));
  const shown = list.rows.length;
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex min-h-(--control-h) items-center justify-between gap-3">
        {/* An empty list says so once, in the box below. */}
        <p className="tabular min-w-0 truncate text-small text-ink-muted">
          {shown > 0 &&
            `${shown} ${shown === 1 ? 'row' : 'rows'}${list.standout ? ` · ${list.standout}` : ''}`}
        </p>
        {!boxOpen && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setBoxOpen(true)}>
            <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
            {list.kind === 'own' ? 'Add a link or name' : `Add to ${list.name}`}
          </Button>
        )}
      </div>
      {boxOpen &&
        (list.kind === 'own' && list.listId ? (
          <AddRowBox
            listId={list.listId}
            seam={seam}
            onAdding={setAdding}
            onClose={() => setBoxOpen(false)}
          />
        ) : (
          <AddLinkedBox goalId={goalId} list={list} onClose={() => setBoxOpen(false)} />
        ))}
      {shown === 0 && !adding ? (
        <EmptyState
          size="box"
          align="start"
          title={
            list.ruledOut.length > 0
              ? 'Everything here is ruled out.'
              : 'Nothing here yet. Paste a link or name one.'
          }
        />
      ) : (
        <ListRows list={list} rows={list.rows} adding={adding} />
      )}
      {list.ruledOut.length > 0 && (
        <Disclosure
          title={<span className="text-small font-normal text-ink-muted">Ruled out</span>}
          meta={String(list.ruledOut.length)}
          defaultOpen={seam?.ruledOutOpen}
          className="mt-auto pt-2"
        >
          <ListRows list={list} rows={list.ruledOut} adding={null} />
        </Disclosure>
      )}
    </div>
  );
}

/**
 * The rows: a table from tablet width, and on a phone one compact row each,
 * the picture beside the name and the figures on one line under it, since a
 * table stacked into label and value lines took a whole screen for two rows.
 */
function ListRows({
  list,
  rows,
  adding,
}: {
  list: ListView;
  rows: ListRowView[];
  adding: string | null;
}) {
  const pictures = list.rows.some((r) => r.picture) || list.ruledOut.some((r) => r.picture);
  return (
    <>
      <div className="max-md:hidden">
        <ListTable list={list} rows={rows} adding={adding} pictures={pictures} />
      </div>
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => (
          <PhoneRow key={row.id} list={list} row={row} pictures={pictures} />
        ))}
        {adding && (
          <li className="flex items-center gap-3 py-2.5" aria-live="polite">
            {pictures && (
              <span
                className="block size-10 shrink-0 animate-pulse rounded-control bg-sunken"
                aria-hidden
              />
            )}
            <span className="text-ui text-ink-muted">{addingLine(adding)}</span>
          </li>
        )}
      </ul>
    </>
  );
}

const addingLine = (text: string) =>
  /^https?:/i.test(text) ? 'Reading the page…' : `Adding ${text}…`;

/** The status column, which a phone row shows on the name's line rather than among the figures. */
const STATUS = 'status';

/** A phone row's figures on one line: "Wide 30 · Deep 15.75 · $189.99". A figure that names itself goes without its label. */
function figuresLine(list: ListView, row: ListRowView): string {
  return list.columns
    .filter((c) => c.key !== STATUS && row.cells[c.key])
    .map((c) => {
      const value = row.cells[c.key] as string;
      return c.num && /^[^0-9-]/.test(value) ? value : `${c.label} ${value}`;
    })
    .join(' · ');
}

/** A picture's tile. The hairline is the photo's edge, so a white product shot does not melt into the panel. */
const THUMB = 'block size-10 shrink-0 overflow-hidden rounded-control border border-border bg-sunken'; // ui-ok: hand-rolled-box -- a photo's frame, not a grouping

function Thumb({ src }: { src: string | null }) {
  return (
    <span className={THUMB}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary shop CDNs
        <img src={src} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}

/** The row's name: a link to its own page, out to the page it was pasted from, or plain once it has gone. */
function RowTitle({ row }: { row: ListRowView }) {
  if (row.external && row.href) {
    return (
      <a
        href={row.href}
        target="_blank"
        rel="noreferrer"
        className="press-area break-words font-semibold text-ink hover:text-accent"
      >
        {row.title}
        <ExternalLink
          className="ml-1 inline size-3.5 align-[-0.125em] text-ink-muted"
          strokeWidth={1.75}
          aria-label="opens the page"
        />
      </a>
    );
  }
  if (row.href) {
    return (
      <Link
        href={row.href}
        className="press-area break-words font-semibold text-ink hover:text-accent"
      >
        {row.title}
      </Link>
    );
  }
  return (
    <span className={cn('break-words font-semibold', row.gone ? 'text-ink-muted' : 'text-ink')}>
      {row.title}
    </span>
  );
}

/** What sits after the name on any row: gone, comments, and a draft's Confirm. */
function RowMarks({ row }: { row: ListRowView }) {
  if (!row.gone && row.comments < 1 && !row.draft) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {row.gone && <Chip size="sm">No longer there</Chip>}
      <CommentCount count={row.comments} />
      {row.draft && <DraftConfirm recordId={row.id} />}
    </span>
  );
}

function PhoneRow({
  list,
  row,
  pictures,
}: {
  list: ListView;
  row: ListRowView;
  pictures: boolean;
}) {
  const status = row.cells[STATUS];
  const figures = figuresLine(list, row);
  return (
    <li className="flex items-start gap-3 py-2.5">
      {pictures && <Thumb src={row.picture} />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline justify-between gap-3 text-ui">
          <span className="min-w-0">
            <RowTitle row={row} /> {row.comments > 0 && <CommentCount count={row.comments} />}
          </span>
          {status && (
            <span
              className={cn(
                'shrink-0 text-small',
                row.picked ? 'font-medium text-accent' : 'text-ink-muted',
              )}
            >
              {status}
            </span>
          )}
        </div>
        {figures && <p className="tabular text-small text-ink-muted">{figures}</p>}
        {(row.gone || row.draft) && <RowMarks row={{ ...row, comments: 0 }} />}
      </div>
    </li>
  );
}

/** The rows as a table: a picture where any row has one, the name, then the list's columns. */
function ListTable({
  list,
  rows,
  adding,
  pictures,
}: {
  list: ListView;
  rows: ListRowView[];
  adding: string | null;
  pictures: boolean;
}) {
  const nameLabel =
    list.kind === 'linked' && list.kinds.length === 1 ? KIND_HEADING[list.kinds[0]] : 'Name';
  const middle = pictures ? 'align-middle' : undefined;
  return (
    <Table flush stack={false} fit>
      <THead>
        <tr>
          {pictures && (
            <TH className="w-14">
              <span className="sr-only">Picture</span>
            </TH>
          )}
          <TH>{nameLabel}</TH>
          {list.columns.map((c) => (
            <TH key={c.key} num={c.num} className="whitespace-nowrap">
              {c.label}
            </TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.id}>
            {pictures && (
              <TD className={cn('w-14', middle)}>
                <Thumb src={row.picture} />
              </TD>
            )}
            <TD className={middle}>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <RowTitle row={row} />
                <RowMarks row={row} />
              </span>
            </TD>
            {list.columns.map((c) => (
              <TD
                key={c.key}
                num={c.num}
                muted={!row.cells[c.key]}
                className={cn(
                  middle,
                  c.key === STATUS && 'whitespace-nowrap',
                  c.key === STATUS && row.picked && 'font-medium text-accent',
                )}
              >
                {row.cells[c.key] || '–'}
              </TD>
            ))}
          </TR>
        ))}
        {adding && (
          <tr aria-live="polite">
            {pictures && (
              <TD className={cn('w-14', middle)}>
                <span
                  className="block size-10 animate-pulse rounded-control bg-sunken"
                  aria-hidden
                />
              </TD>
            )}
            <TD muted className={middle} colSpan={list.columns.length + 1}>
              {addingLine(adding)}
            </TD>
          </tr>
        )}
      </TBody>
    </Table>
  );
}

const KIND_HEADING: Record<ListedKind, string> = {
  reading: 'Reading',
  event: 'Event',
  saved_item: 'Product',
  contact: 'Person',
};

/** A row a link filled in: marked Draft, with the press that confirms it as it stands. */
function DraftConfirm({ recordId }: { recordId: string }) {
  const [state, confirm, pending] = useActionState(
    async (_prev: ListActionState, form: FormData) => confirmListRowAction(form),
    {},
  );
  return (
    <form action={confirm} className="relative z-10 inline-flex items-center gap-1.5">
      <input type="hidden" name="recordId" value={recordId} />
      <Chip tone="caution" size="sm">
        Draft
      </Chip>
      <Button type="submit" variant="secondary" size="xs" pending={pending}>
        Confirm
      </Button>
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </form>
  );
}

/**
 * An own list's add box: a pasted link is read as a draft, anything else is
 * a row's name. What was typed stays in the box until it is added, so a link
 * that could not be read is still there to change.
 */
function AddRowBox({
  listId,
  seam,
  onAdding,
  onClose,
}: {
  listId: string;
  seam?: ListsSeam;
  onAdding: (text: string | null) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(seam?.adding ?? seam?.typed ?? '');
  const [state, add, pending] = useActionState(async (prev: ListActionState, form: FormData) => {
    const typed = String(form.get('text') ?? '').trim();
    onAdding(typed || null);
    const result = await addListRowAction(prev, form);
    onAdding(null);
    if (!result.error) setText('');
    return result;
  }, seam?.addState ?? {});
  const busy = pending || Boolean(seam?.adding);
  return (
    <form action={add} className="space-y-1.5">
      <input type="hidden" name="listId" value={listId} />
      <div className="flex items-center gap-2">
        {/* The label wraps the field, so a finger's 44 pixels reach it on a phone. */}
        <label className="min-w-0 flex-1 py-1">
          <span className="sr-only">Paste a link or type a name</span>
          <Input
            id={`${id}-text`}
            name="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && text === '') {
                event.stopPropagation();
                onClose();
              }
            }}
            placeholder="https://… or a name"
            autoComplete="off"
            autoFocus={!seam}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error || state.note ? `${id}-said` : undefined}
            className={cn('w-full', state.error && 'border-danger')}
          />
        </label>
        <Button type="submit" pending={busy}>
          Add
        </Button>
      </div>
      {state.error ? (
        <FieldError id={`${id}-said`}>{state.error}</FieldError>
      ) : state.note ? (
        <p id={`${id}-said`} className="text-small text-caution">
          {state.note}
        </p>
      ) : null}
    </form>
  );
}

/** What a picked search hit is, as a list kind, or null for a kind no list holds. */
function listedKindOf(choice: LinkChoice): ListedKind | null {
  const kind = choice.target === 'saved' ? 'saved_item' : choice.target;
  return isListedKind(kind) ? kind : null;
}

/** A linked list's add box: find a reading, saved product or contact and add it to this list. */
function AddLinkedBox({
  goalId,
  list,
  onClose,
}: {
  goalId: string;
  list: ListView;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<LinkChoice | null>(null);
  const [state, add, pending] = useActionState(async (prev: LinkActionState, form: FormData) => {
    if (!choice) return { error: 'Find something to add first.' };
    const kind = listedKindOf(choice);
    if (!kind || kind === 'event')
      return { error: 'A list here holds readings, saved products and people.' };
    form.set('kind', kind);
    form.set('targetId', choice.targetId);
    const result = await linkRowAction(prev, form);
    if (!result.error) {
      setChoice(null);
      onClose();
    }
    return result;
  }, {});
  return (
    <form action={add} className="space-y-1.5">
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="list" value={list.name} />
      <div className="flex flex-wrap items-center gap-2">
        <LinkPicker value={choice} onChange={setChoice} />
        <Button type="submit" pending={pending} disabled={!choice}>
          Add
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {state.error && <FieldError>{state.error}</FieldError>}
    </form>
  );
}

/** Start a list: its name, then Add. It holds a name, a link and notes until a link adds more. */
export function NewListForm({ goalId, onClose }: { goalId: string; onClose: () => void }) {
  const id = useId();
  const [state, add, pending] = useActionState(async (prev: ListActionState, form: FormData) => {
    const result = await addGoalListAction(prev, form);
    if (!result.error) onClose();
    return result;
  }, {});
  return (
    <form action={add} className="space-y-1.5">
      <input type="hidden" name="goalId" value={goalId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-name`} className="sr-only">
          The list&apos;s name
        </label>
        <Input
          id={`${id}-name`}
          name="name"
          placeholder="Name the list, such as Pantry options"
          autoComplete="off"
          autoFocus
          className="min-w-0 flex-1 sm:max-w-sm"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
        />
        <Button type="submit" pending={pending}>
          Start the list
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {state.error && <FieldError>{state.error}</FieldError>}
    </form>
  );
}
