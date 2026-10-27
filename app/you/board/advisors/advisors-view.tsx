'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError, FieldHint, Input, Label, Switch } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { LiveDot } from '@/components/ui/live-dot';
import { SectionLabel } from '@/components/ui/section-heading';
import { Tooltip } from '@/components/ui/tooltip';
import {
  brainState,
  FOCUS_MAX,
  NAME_MAX,
  type BrainState,
  type RosterAdvisor,
} from '@/lib/you/board-advisors';
import { AdvisorMark } from '../advisor-mark';
import { useRefreshWhileRunning } from '../refresh-while-running';

/**
 * The Advisors view of the Board tab (plan #2561.7), on the list pattern: the
 * header with its one action, Add advisor, then one surface in two groups.
 * The five seats come first and always sit. Under them every guest: a persona
 * Dash builds from a person's public work, shown by initials, with the
 * question they own, the state of their brain and a switch for whether the
 * chair may bring them in. A guest whose brain is being built shows it; one
 * that failed says why and offers a retry.
 */

export type AdvisorActions = {
  add: (input: { name: string; focus: string }) => Promise<{ error: string | null; saved?: boolean }>;
  retry: (id: string) => Promise<{ error: string | null }>;
  setActive: (id: string, active: boolean) => Promise<{ error: string | null }>;
};

/** How the press starts: closed, with the card open and filled, or refusing a name (the gallery draws each). */
export type AddStart = 'closed' | 'form' | 'error';

export const SAMPLE_NAME = 'Marcus Aurelius';
export const SAMPLE_FOCUS = 'How to act well when you do not control the outcome.';
export const SAMPLE_ADD_ERROR = 'Marcus Aurelius is already on your board.';

export function AdvisorsView({
  advisors,
  now,
  actions,
  subject,
  start = 'closed',
}: {
  advisors: readonly RosterAdvisor[];
  /** When the page was read, for whether a build is still going. */
  now: number;
  actions: AdvisorActions;
  subject?: Subject;
  start?: AddStart;
}) {
  const [open, setOpen] = useState(start !== 'closed');
  const [name, setName] = useState(start === 'closed' ? '' : SAMPLE_NAME);
  const [focus, setFocus] = useState(start === 'closed' ? '' : SAMPLE_FOCUS);
  const [error, setError] = useState<string | null>(start === 'error' ? SAMPLE_ADD_ERROR : null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const states = advisors.map((advisor) => brainState(advisor, now));
  useRefreshWhileRunning(states.some((state) => state.kind === 'building'));

  const close = () => {
    setOpen(false);
    setError(null);
  };
  const submit = () => {
    setPending(true);
    setError(null);
    startTransition(async () => {
      const result = await actions.add({ name, focus });
      setPending(false);
      if (result.error && !result.saved) {
        setError(result.error);
        return;
      }
      // Saved. A build that could not start says why on the guest's own row.
      setName('');
      setFocus('');
      close();
    });
  };

  const seats = advisors.filter((a) => a.kind === 'seat');
  const guests = advisors.filter((a) => a.kind === 'guest');
  const stateOf = (advisor: RosterAdvisor): BrainState => states[advisors.indexOf(advisor)];

  return (
    <PageColumn>
      <PageHeader
        title="Advisors"
        subject={subject}
        actions={
          <Button
            type="button"
            variant="secondary"
            aria-expanded={open}
            aria-controls="add-advisor"
            onClick={() => {
              setError(null);
              setOpen((current) => !current);
            }}
          >
            Add advisor
          </Button>
        }
      />
      {open && (
        <Card id="add-advisor" padding="standard" className="mb-4">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && !pending) submit();
            }}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="advisor-name">Who to add</Label>
                <Tooltip label="Close without adding" align="end">
                  <IconButton label="Close without adding" onClick={close} disabled={pending}>
                    <X aria-hidden strokeWidth={1.75} />
                  </IconButton>
                </Tooltip>
              </div>
              <Input
                id="advisor-name"
                value={name}
                maxLength={NAME_MAX}
                placeholder="Marcus Aurelius"
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div>
              <Label htmlFor="advisor-focus">What they look at (optional)</Label>
              <Input
                id="advisor-focus"
                value={focus}
                maxLength={FOCUS_MAX}
                placeholder="Duty, restraint and what is in your control"
                onChange={(event) => setFocus(event.target.value)}
              />
              <FieldHint>
                Dash builds a persona from their books, talks and other public work. It speaks as the
                persona, never as the person.
              </FieldHint>
            </div>
            <FieldError id="advisor-error">{error}</FieldError>
            <div className="flex flex-wrap items-center gap-2">
              <DashAction
                type="submit"
                pending={pending}
                disabled={!name.trim() || pending}
                routine="board"
                what="Cost of building an advisor"
                align="start"
              >
                {pending ? 'Adding…' : 'Add and build'}
              </DashAction>
            </div>
          </form>
        </Card>
      )}
      <Card padding="none">
        <ul className="divide-y divide-border">
          <Group title="Seats" count={seats.length}>
            {seats.map((advisor) => (
              <AdvisorRow key={advisor.id} advisor={advisor} state={stateOf(advisor)} actions={actions} />
            ))}
          </Group>
          <Group title="Guests" count={guests.length}>
            {guests.map((advisor) => (
              <AdvisorRow key={advisor.id} advisor={advisor} state={stateOf(advisor)} actions={actions} />
            ))}
          </Group>
        </ul>
      </Card>
    </PageColumn>
  );
}

/** One group of the roster, folded away by its heading with its count kept on the folded line. */
function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Disclosure
        defaultOpen
        remember={`you.board.advisors.fold.${title}`}
        title={
          <SectionLabel as="span" count={count}>
            {title}
          </SectionLabel>
        }
        summaryClassName="card-pad-x rounded-none pb-1 pt-3"
        bodyClassName=""
      >
        <ul className="divide-y divide-border">{children}</ul>
      </Disclosure>
    </li>
  );
}

function AdvisorRow({
  advisor,
  state,
  actions,
}: {
  advisor: RosterAdvisor;
  state: BrainState;
  actions: AdvisorActions;
}) {
  const [active, setActive] = useState(advisor.active);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [, startTransition] = useTransition();
  const guest = advisor.kind === 'guest';

  const toggle = (next: boolean) => {
    setActive(next);
    setError(null);
    startTransition(async () => {
      const result = await actions.setActive(advisor.id, next);
      if (result.error) {
        setActive(!next);
        setError(result.error);
      }
    });
  };
  const retry = () => {
    setRetrying(true);
    setError(null);
    startTransition(async () => {
      const result = await actions.retry(advisor.id);
      setRetrying(false);
      if (result.error) setError(result.error);
    });
  };

  return (
    <li className="card-pad-x row-pad">
      <div className="flex min-h-11 items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui text-ink">
            {guest && <AdvisorMark name={advisor.name} />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{advisor.name}</span>
            <BrainStatus state={state} />
          </span>
          <span className="mt-0.5 block text-small text-ink-muted [overflow-wrap:anywhere]">
            {advisor.question}
          </span>
          {advisor.focus && (
            <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">{advisor.focus}</span>
          )}
        </span>
        {guest && (
          <Tooltip
            label={active ? 'The chair may bring them in' : 'Kept off the board'}
            align="end"
          >
            <Switch
              aria-label={`${advisor.name}: the chair may bring them in`}
              checked={active}
              onChange={(event) => toggle(event.target.checked)}
              className="mt-1"
            />
          </Tooltip>
        )}
      </div>
      {guest && state.kind === 'building' && (
        <p className="mt-1 text-small text-ink-muted">
          Dash is reading their public work. This takes a while, and the guest sits once it is done.
        </p>
      )}
      {guest && state.kind === 'failed' && (
        <div className="mt-1.5 space-y-2">
          <p className="text-small text-danger [overflow-wrap:anywhere]">{state.why}</p>
          <DashAction
            type="button"
            variant="secondary"
            size="sm"
            pending={retrying}
            routine="board"
            what="Cost of building an advisor"
            onClick={retry}
          >
            <RotateCcw aria-hidden strokeWidth={1.75} className="size-3.5" />
            {retrying ? 'Retrying…' : 'Try again'}
          </DashAction>
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
    </li>
  );
}

/** A guest's brain in a shape and words, grey when all is well and coloured only where it needs the person. */
function BrainStatus({ state }: { state: BrainState }) {
  if (state.kind === 'seat') return null;
  const base = 'inline-flex items-center gap-1 whitespace-nowrap text-small';
  if (state.kind === 'ready') {
    return (
      <span className={`${base} tabular text-ink-muted`}>
        <Check aria-hidden strokeWidth={1.75} className="size-3.5" />
        {`Ready · ${state.sources} sources`}
      </span>
    );
  }
  if (state.kind === 'building') {
    return (
      <span className={`${base} text-ink-muted`}>
        <LiveDot tone="muted" className="size-1.5" />
        Building
      </span>
    );
  }
  return (
    <span className={`${base} text-danger`}>
      <AlertTriangle aria-hidden strokeWidth={1.75} className="size-3.5" />
      Build failed
    </span>
  );
}
