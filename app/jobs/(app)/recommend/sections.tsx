'use client';

import Form from 'next/form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Mail,
  Search,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/field';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { PaidHint } from '@/components/ui/paid-hint';
import { ScoreReasons } from '@/components/jobs/ui/score-figures';
import { CHANCE_BAND_LABELS } from '@/lib/jobs/suggest/chance-check';
import { FIT_MINIMUMS, type ScoreNote } from '@/lib/jobs/suggest/score-notes';
import { activeFilters, OPENING_PARAMS, type OpeningView } from '@/lib/jobs/suggest/opening-view';
import { gmailComposeUrl } from '@/lib/jobs/followup/compose';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import { linkedinSearchUrl, splitSubject } from '@/lib/jobs/suggest/payload';
import {
  NO_OPENING_FILTER,
  OPENING_SORT_LABELS,
  OPENING_SORTS,
  passesFilter,
  SCORE_CONFIDENCE_FLOOR,
  scoreChips,
  sortOpenings,
  WORKPLACE_LABELS,
} from '@/lib/jobs/suggest/scores';
import { DISMISS_REASON_LABELS, DISMISS_REASONS } from '@/lib/jobs/suggest/feedback';
import { formatCost, OPENING_ORIGIN_LABELS, type OriginStats } from '@/lib/jobs/suggest/stats';
import type { RunLine } from '@/lib/jobs/suggest/search-runs';
import {
  dismissOpening,
  dismissSuggestion,
  markSuggestionSent,
  saveOpening,
  suggestOpenings,
  suggestPeople,
  type SuggestState,
} from './actions';
import { DashMark } from '@/components/ui/dash-mark';
import { LinkedText } from '@/components/ui/linked-text';

const CHANNEL_LABELS: Record<string, string> = {
  linkedin_dm: 'LinkedIn message',
  linkedin_connect: 'LinkedIn connection note',
  email: 'Email',
  intro: 'Ask for an intro',
  event: 'In person, at the event',
  other: 'Message',
};

/**
 * Dash's recommendations, each list on the page it belongs to: people to meet
 * at the top of Contacts, roles to apply for at the top of Roles. The daily
 * run fills them (lib/jobs/suggest), so they are there when the page opens;
 * the search button is for a list that has run dry.
 */
function RecommendedSection({
  title,
  hint,
  empty,
  button,
  searching: searchingLabel,
  paidHint,
  action,
  count,
  toolbar,
  footer,
  status,
  children,
}: {
  title: string;
  /** Shown above a list with rows; leave it out when the heading says enough (law 15). */
  hint?: string;
  empty: string;
  button: string;
  searching: string;
  /** The PaidHint for the search button, written out where the action is named. */
  paidHint: React.ReactNode;
  action: () => Promise<SuggestState>;
  count: number;
  /** Sort and filter controls, shown under the hint while the list is open. */
  toolbar?: React.ReactNode;
  /** Shown under the list while it is open, whether or not anything is in it. */
  footer?: React.ReactNode;
  /** How the latest search went, or what it is doing (search-runs.ts). */
  status?: RunLine | null;
  children: React.ReactNode;
}) {
  const [pending, run] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const searching = pending || !!status?.running;
  // While a search runs in the background, read the page again every few
  // seconds so its stage, and then what it found, show without a reload.
  // A search a batch is finishing (status.waiting) takes up to an hour and is
  // collected every ten minutes, so it is checked once a minute instead.
  const every = status?.waiting ? 60_000 : 8000;
  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => router.refresh(), every);
    return () => window.clearInterval(timer);
  }, [status?.running, every, router]);
  // Folds to its header (note b4a23b56), and stays folded on this device.
  // Read after mounting, so the server and the first paint agree.
  const foldKey = `jobs.fold.${title}`;
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored choice exists only in the browser
      setFolded(window.localStorage.getItem(foldKey) === '1');
    } catch {
      // Storage refused: the section starts open, as it always did.
    }
  }, [foldKey]);
  const fold = () => {
    const next = !folded;
    setFolded(next);
    try {
      window.localStorage.setItem(foldKey, next ? '1' : '0');
    } catch {
      // Not remembered, which only costs the next visit a press.
    }
  };

  const ask = () => {
    setNotice(null);
    run(async () => {
      const result = await action();
      setNotice(result.error ?? result.message ?? null);
      router.refresh();
    });
  };

  return (
    <Card padding="dense">
      <header
        className={cn('flex flex-wrap items-center justify-between gap-2', !folded && 'mb-1')}
      >
        <button
          type="button"
          onClick={fold}
          aria-expanded={!folded}
          title={folded ? `Show ${title.toLowerCase()}` : `Fold ${title.toLowerCase()}`}
          className="press flex items-baseline gap-2 rounded-control text-left"
        >
          <ChevronDown
            className={cn(
              'size-3.5 self-center text-ink-muted transition-transform duration-150',
              folded && '-rotate-90',
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          <DashMark size="icon" decorative className="self-center text-accent" />
          <h2 className="text-ui font-semibold text-ink">{title}</h2>
          {count > 0 && <span className="tabular text-small text-ink-muted">{count}</span>}
        </button>
        <span className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" pending={searching} onClick={ask}>
            {searching ? searchingLabel : button}
          </Button>
          {paidHint}
        </span>
      </header>
      {!folded && (
        <>
          {(count > 0 ? hint : empty) && (
            <p className="mb-2 text-small text-ink-muted">{count > 0 ? hint : empty}</p>
          )}
          {status && (
            <p
              role="status"
              className={cn(
                'mb-2 text-small',
                status.tone === 'warn' ? 'text-caution' : 'text-ink-muted',
              )}
            >
              {status.text}
            </p>
          )}
          {notice && <p className="mb-2 text-small text-ink-muted">{notice}</p>}
          {count > 0 && toolbar}
          {count > 0 && <ul className="divide-y divide-border">{children}</ul>}
          {footer}
        </>
      )}
      {folded && status?.running && <p className="mt-1 text-small text-ink-muted">{status.text}</p>}
      {folded && notice && <p className="mt-1 text-small text-ink-muted">{notice}</p>}
    </Card>
  );
}

export function RecommendedPeople({ suggestions }: { suggestions: OpenSuggestion[] }) {
  return (
    <RecommendedSection
      title="People to meet"
      hint="People worth reaching out to, from Dash's searches and anything a goal step turned up, with what to say. Sent adds them to your contacts."
      empty="Dash looks for new people every few days, from your career goals and CV. The next ones will appear here."
      button="Search now"
      searching="Searching…"
      paidHint={
        <PaidHint
          action="app/jobs/(app)/recommend/actions.ts#suggestPeople"
          what="Cost of a search for people"
          align="end"
        />
      }
      action={suggestPeople}
      count={suggestions.length}
    >
      {suggestions.map((suggestion) => (
        <PersonRow key={suggestion.id} suggestion={suggestion} />
      ))}
    </RecommendedSection>
  );
}

export function RecommendedRoles({
  suggestions,
  view = { sort: 'newest', filter: NO_OPENING_FILTER },
  keep = [],
  pathname = '/jobs/roles',
  stats = [],
  searchCostMicros = 0,
  searchLine = null,
}: {
  suggestions: OpenSuggestion[];
  /** Sort and filters, read from the URL by the page (opening-view.ts). */
  view?: OpeningView;
  /** The page's other parameters, carried through the filter form. */
  keep?: [string, string][];
  pathname?: string;
  /** How the latest roles search went (search-runs.ts `describeRun`). */
  searchLine?: RunLine | null;
  /** Each source's record (lib/jobs/suggest/stats.ts). */
  stats?: OriginStats[];
  /** What the web searches have cost in all, in micro-dollars. */
  searchCostMicros?: number;
}) {
  const shown = useMemo(
    () =>
      sortOpenings(
        suggestions.filter((s) => passesFilter(s, view.filter)),
        view.sort,
      ),
    [suggestions, view],
  );
  const scored = suggestions.some((s) => s.scores);

  return (
    <RecommendedSection
      title="Recommended roles"
      empty="Dash searches for open roles every week, from your career goals, CV and the boards of companies you follow. Save one to add it to your pipeline as a lead."
      button="Search now"
      searching="Searching…"
      paidHint={
        <PaidHint
          action="app/jobs/(app)/recommend/actions.ts#suggestOpenings"
          what="Cost of a search for roles"
          align="end"
        />
      }
      action={suggestOpenings}
      count={suggestions.length}
      footer={<SourceStats stats={stats} searchCostMicros={searchCostMicros} />}
      status={searchLine}
      toolbar={
        scored ? (
          <OpeningControls
            view={view}
            keep={keep}
            pathname={pathname}
            shown={shown.length}
            total={suggestions.length}
          />
        ) : null
      }
    >
      {shown.map((suggestion) => (
        <RoleRow key={suggestion.id} suggestion={suggestion} />
      ))}
    </RecommendedSection>
  );
}

/**
 * Sort and filter the recommended roles by Jev's answers (plan #1178).
 *
 * A GET form, so the choice lives in the URL (law 5) and works before
 * JavaScript (law 6): each control submits on change, and without script
 * the Apply button does. Its parameters start with `r` (opening-view.ts), and
 * the page's other parameters ride along as hidden fields, so narrowing this
 * list leaves the table's filters alone. The filters fold behind one
 * <details>, open whenever one is set. An opening not yet scored passes
 * every filter.
 */
function OpeningControls({
  view,
  keep,
  pathname,
  shown,
  total,
}: {
  view: OpeningView;
  keep: [string, string][];
  pathname: string;
  shown: number;
  total: number;
}) {
  const { sort, filter } = view;
  const active = activeFilters(filter);
  const submit = (event: React.ChangeEvent<HTMLSelectElement>) =>
    event.currentTarget.form?.requestSubmit();
  const cleared =
    keep.length > 0 ? `${pathname}?${new URLSearchParams(keep).toString()}` : pathname;
  return (
    // Keyed on the view, so the selects start from the URL again after Clear
    // or the back button rather than keeping what was last picked.
    <Form
      key={JSON.stringify(view)}
      action={pathname}
      replace
      scroll={false}
      className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-small"
    >
      {keep.map(([key, value], index) => (
        <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
      ))}
      {/* Filters first: it takes the whole line when open, and its summary
          stays where it was rather than jumping below the sort. */}
      <details open={active > 0} className="group/filters [&[open]]:basis-full">
        <summary
          className={cn(
            'press flex cursor-pointer list-none items-center gap-1 rounded-control px-2 py-1 font-medium',
            '[&::-webkit-details-marker]:hidden',
            active > 0 ? 'text-ink' : 'text-ink-muted hover:text-ink',
          )}
        >
          <ChevronRight
            className="size-3.5 transition-transform duration-150 group-open/filters:rotate-90"
            strokeWidth={1.75}
            aria-hidden
          />
          {active > 0 ? `Filters · ${active}` : 'Filters'}
          {active > 0 && (
            <span className="tabular ml-1 font-normal text-ink-muted">
              {shown} of {total}
            </span>
          )}
        </summary>
        <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
          <ChipSelect
            name={OPENING_PARAMS.workplace}
            aria-label="Filter by workplace"
            placeholderValue="any"
            defaultValue={filter.workplace}
            onChange={submit}
          >
            <option value="any">Any workplace</option>
            {(['remote', 'hybrid', 'on_site'] as const).map((value) => (
              <option key={value} value={value}>
                {WORKPLACE_LABELS[value]}
              </option>
            ))}
          </ChipSelect>
          <ChipSelect
            name={OPENING_PARAMS.fit}
            aria-label="Filter by match to your evidence"
            placeholderValue="any"
            defaultValue={filter.fit}
            onChange={submit}
          >
            <option value="any">Any match</option>
            <option value="strong">Strong match</option>
            <option value="partial_up">Partial or strong match</option>
          </ChipSelect>
          <ChipSelect
            name={OPENING_PARAMS.salary}
            aria-label="Filter by salary"
            placeholderValue="any"
            defaultValue={filter.salary ? 'shown' : 'any'}
            onChange={submit}
          >
            <option value="any">Any pay</option>
            <option value="shown">Salary shown</option>
          </ChipSelect>
          <ChipSelect
            name={OPENING_PARAMS.coverLetter}
            aria-label="Filter by cover letter"
            placeholderValue="any"
            defaultValue={filter.coverLetter}
            onChange={submit}
          >
            <option value="any">Cover letter or not</option>
            <option value="yes">Asks for a cover letter</option>
            <option value="no">No cover letter</option>
          </ChipSelect>
          <ChipSelect
            name={OPENING_PARAMS.minFit}
            aria-label="Lowest fit to show"
            placeholderValue="0"
            defaultValue={String(filter.minFit)}
            onChange={submit}
          >
            <option value="0">Any fit</option>
            {FIT_MINIMUMS.map((value) => (
              <option key={value} value={value}>
                Fit {value} and up
              </option>
            ))}
          </ChipSelect>
          <ChipSelect
            name={OPENING_PARAMS.minChance}
            aria-label="Lowest chance of an interview to show"
            placeholderValue="any"
            defaultValue={filter.minChance}
            onChange={submit}
          >
            <option value="any">Any chance of an interview</option>
            <option value="medium">
              {CHANCE_BAND_LABELS.medium} chance of an interview or better
            </option>
            <option value="high">{CHANCE_BAND_LABELS.high} chance of an interview</option>
          </ChipSelect>
          <ChipSelect
            name={OPENING_PARAMS.hideRedFlags}
            aria-label="Red flags"
            placeholderValue="show"
            defaultValue={filter.hideRedFlags ? 'hide' : 'show'}
            onChange={submit}
          >
            <option value="show">With red flags</option>
            <option value="hide">Without red flags</option>
          </ChipSelect>
          <ChipSelect
            name={OPENING_PARAMS.hideDuplicates}
            aria-label="Roles already on file"
            placeholderValue="show"
            defaultValue={filter.hideDuplicates ? 'hide' : 'show'}
            onChange={submit}
          >
            <option value="show">With ones on file</option>
            <option value="hide">New to you only</option>
          </ChipSelect>
          {active > 0 && (
            <Link
              href={cleared}
              replace
              scroll={false}
              className="ml-1 font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Clear
            </Link>
          )}
        </div>
      </details>
      <ChipSelect
        name={OPENING_PARAMS.sort}
        aria-label="Sort recommended roles"
        placeholderValue="newest"
        defaultValue={sort}
        onChange={submit}
      >
        {OPENING_SORTS.map((value) => (
          <option key={value} value={value}>
            {OPENING_SORT_LABELS[value]}
          </option>
        ))}
      </ChipSelect>
      <noscript>
        <button
          type="submit"
          className="px-2 py-1 font-medium text-ink underline underline-offset-2"
        >
          Apply
        </button>
      </noscript>
    </Form>
  );
}

/**
 * How each source of recommended roles has done: found, saved, applied,
 * reached an interview, turned down, and for the paid search what it cost.
 * Folded by default, with the one fact that says whether to open it on the
 * closed line (law 10): how many of all the roles found were saved.
 */
function SourceStats({
  stats,
  searchCostMicros,
}: {
  stats: OriginStats[];
  searchCostMicros: number;
}) {
  if (stats.length === 0) return null;
  const found = stats.reduce((sum, line) => sum + line.found, 0);
  const saved = stats.reduce((sum, line) => sum + line.saved, 0);
  return (
    <div className="mt-2 border-t border-border pt-1">
      <Disclosure title="Where these come from" meta={`${saved} of ${found} saved`}>
        <ul className="space-y-1 text-small text-ink-muted">
          {stats.map((line) => (
            <li key={line.origin} className="tabular">
              <span className="font-medium text-ink">{OPENING_ORIGIN_LABELS[line.origin]}</span>:{' '}
              {line.found} found, {line.saved} saved, {line.applied} applied, {line.interviews}{' '}
              {line.interviews === 1 ? 'interview' : 'interviews'}, {line.dismissed} turned down
              {line.expired > 0 ? `, ${line.expired} closed or dropped` : ''}
              {line.origin === 'search' && searchCostMicros > 0
                ? `. Searches cost ${formatCost(searchCostMicros)} so far`
                : ''}
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

/**
 * Jev's answers that say something the rest of the row does not: the level,
 * how close it is to past applications, and a cover letter or a role already
 * on file when there is one. The unremarkable defaults (no red flags, no
 * cover letter, new to you) are left out, and so are the answers the facts
 * line and the reasons already give (workplace, pay, fit, red flags), so the
 * few that differ are what the eye finds (law 17). An unsure one carries a
 * question mark.
 */
function OpeningAnswers({ suggestion }: { suggestion: OpenSuggestion }) {
  const s = suggestion.scores;
  if (!s) return null;
  const chips = scoreChips(s).filter(
    (chip) =>
      chip.key === 'seniority' ||
      chip.key === 'closeness' ||
      (chip.key === 'cover_letter' && !!s.cover_letter?.value) ||
      (chip.key === 'duplicate' && !!s.duplicate?.value),
  );
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Dash's answers about this opening">
      {chips.map((chip) => (
        <li
          key={chip.key}
          title={chip.unsure ? 'Dash is not sure of this one' : undefined}
          className={cn(
            'rounded-control px-1.5 py-0.5 text-small',
            chip.tone === 'warn' ? 'bg-caution-tint text-caution' : 'bg-sunken text-ink-muted',
            chip.unsure && 'opacity-70',
          )}
        >
          {chip.label}
          {chip.unsure ? '?' : ''}
        </li>
      ))}
    </ul>
  );
}

function PersonRow({ suggestion }: { suggestion: OpenSuggestion }) {
  const [busy, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = suggestion.message ?? '';
  const email = suggestion.channel === 'email' ? splitSubject(message) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email ? email.body : message);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the text instead.');
    }
  };

  const act = (action: () => Promise<{ error: string | null }>) =>
    start(async () => {
      const result = await action();
      setError(result.error);
    });

  return (
    <li className="row-pad space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-ui font-medium text-ink">{suggestion.headline}</span>
        {suggestion.personName && (
          <span className="text-small text-ink-muted">
            {suggestion.personName}
            {suggestion.personTitle ? `, ${suggestion.personTitle}` : ''}
          </span>
        )}
        {suggestion.companyName && (
          <span className="text-small text-ink-muted">
            {suggestion.companySlug ? (
              <Link
                href={`/jobs/companies/${suggestion.companySlug}`}
                className="hover:text-accent"
              >
                {suggestion.companyName}
              </Link>
            ) : (
              suggestion.companyName
            )}
          </span>
        )}
        {suggestion.channel && (
          <span className="text-small text-ink-muted">
            {CHANNEL_LABELS[suggestion.channel] ?? 'Message'}
          </span>
        )}
      </div>
      <p className="text-small text-ink-muted">{suggestion.why}</p>
      {suggestion.foundIn && <p className="text-small text-ink-muted">{suggestion.foundIn}</p>}
      <p className="whitespace-pre-line text-ui text-ink">
        <LinkedText text={suggestion.move} />
      </p>
      {message && (
        <div className="rounded-card bg-canvas p-3">
          {email?.subject && (
            <p className="mb-1 text-small font-medium text-ink">Subject: {email.subject}</p>
          )}
          <p className="whitespace-pre-wrap text-ui leading-relaxed text-ink">
            <LinkedText text={email ? email.body : message} />
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
          {copied ? 'Copied' : 'Copy message'}
        </Button>
        {email && suggestion.contact?.email && (
          <a
            href={gmailComposeUrl({
              emailAddress: null,
              to: suggestion.contact.email,
              subject: email.subject ?? '',
              body: email.body,
            })}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Mail className="size-3.5" strokeWidth={1.75} aria-hidden />
            Open in Gmail
          </a>
        )}
        {suggestion.searchQuery && !suggestion.contact?.linkedinUrl && (
          <a
            href={linkedinSearchUrl(suggestion.searchQuery)}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
            Find on LinkedIn
          </a>
        )}
        {suggestion.sourceUrl && (
          <a
            href={suggestion.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
            {suggestion.personName ? 'Where Dash found them' : 'Details'}
          </a>
        )}
        {suggestion.contact?.linkedinUrl && (
          <a
            href={suggestion.contact.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
            LinkedIn
          </a>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            pending={busy}
            onClick={() => act(() => dismissSuggestion(suggestion.id))}
          >
            Not now
          </Button>
          <Button
            type="button"
            size="sm"
            pending={busy}
            onClick={() => act(() => markSuggestionSent(suggestion.id))}
          >
            Sent
          </Button>
        </span>
      </div>
      {error && <p className="text-small text-danger">{error}</p>}
    </li>
  );
}

/** The move's numbered steps ("1. … 2. …") as a list, or null when it is not numbered. */
function moveSteps(move: string): string[] | null {
  const steps = move
    .split(/\s*(?=\b\d{1,2}\.\s)/)
    .map((step) => step.replace(/^\d{1,2}\.\s*/, '').trim())
    .filter(Boolean);
  return steps.length >= 2 ? steps : null;
}

const FIT_WORDS = { strong: 'Strong', partial: 'Partial', weak: 'Weak' } as const;

/**
 * Fit as the facts line shows it. The figure only when Jev was sure and read
 * the posting itself; otherwise a word, since a two-digit number read from
 * Dash's two-sentence summary claims a precision it does not have (law 3),
 * which is why chance already shows as a band.
 */
function fitFact(suggestion: OpenSuggestion, fit: NonNullable<ScoreNote['fit']>): string {
  if (!fit.unsure && suggestion.postingRead) return `Fit ${fit.value}`;
  const word =
    suggestion.scores?.fit?.value ??
    (fit.value >= 67 ? 'strong' : fit.value >= 34 ? 'partial' : 'weak');
  return `${FIT_WORDS[word]} fit${fit.unsure ? '?' : ''}`;
}

/**
 * The one line under a role's title: where, fit, chance, whether the pay is
 * shown, and anything that warns against it. The fit and chance reasons are
 * in the Details and in each figure's tooltip. Each fact carries its own
 * separator and does not break inside, so a wrapped line starts on the text
 * edge rather than with a dot (law 18).
 */
function RoleFacts({ suggestion }: { suggestion: OpenSuggestion }) {
  const note = suggestion.scoreNote;
  const scores = suggestion.scores;
  const sure = (answer: { confidence: number } | undefined) =>
    !!answer && answer.confidence >= SCORE_CONFIDENCE_FLOOR;
  const facts: {
    key: string;
    text: string;
    title?: string;
    warn?: boolean;
    faint?: boolean;
    figure?: boolean;
  }[] = [];
  if (suggestion.location) facts.push({ key: 'where', text: suggestion.location });
  if (note?.fit) {
    facts.push({
      key: 'fit',
      text: fitFact(suggestion, note.fit),
      title: note.fit.reason ?? undefined,
      faint: note.fit.unsure,
      figure: true,
    });
  }
  if (note?.chance) {
    facts.push({
      key: 'chance',
      text: `${CHANCE_BAND_LABELS[note.chance.band]} chance${note.chance.unsure ? '?' : ''}`,
      title: note.chance.reason
        ? `Chance of an interview. ${note.chance.reason}`
        : 'Chance of an interview',
      faint: note.chance.unsure,
    });
  }
  if (scores?.salary?.value && sure(scores.salary)) facts.push({ key: 'pay', text: 'Pay shown' });
  for (const miss of suggestion.misses ?? []) facts.push({ key: miss, text: miss, warn: true });
  if (scores?.red_flags?.value && sure(scores.red_flags))
    facts.push({ key: 'flags', text: 'Red flags', warn: true });
  if (!scores) facts.push({ key: 'unscored', text: 'Not scored yet', faint: true });
  return (
    <p className="text-small text-ink-muted">
      {facts.map((fact, index) => (
        <span key={fact.key}>
          <span className="whitespace-nowrap">
            <span
              title={fact.title}
              className={cn(
                fact.figure && 'tabular',
                fact.warn && 'text-caution',
                fact.faint && 'opacity-70',
              )}
            >
              {fact.text}
            </span>
            {index < facts.length - 1 && <span aria-hidden> ·</span>}
          </span>{' '}
        </span>
      ))}
    </p>
  );
}

/**
 * A recommended role, read in three lines: title (the link to the posting),
 * the facts, and why it fits. Details is a <details>, so it folds before
 * JavaScript loads (law 10); while it is open the row's action line drops
 * below it and the why stops being cut. Not for me asks why before it turns
 * the role down: the reason is what the next search learns from
 * (lib/jobs/suggest/feedback.ts).
 */
function RoleRow({ suggestion }: { suggestion: OpenSuggestion }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const steps = moveSteps(suggestion.move);

  const act = (action: () => Promise<{ error: string | null }>) =>
    start(async () => {
      const result = await action();
      setError(result.error);
    });

  const title = (
    <>
      {suggestion.companyName ? (
        <span className="text-ink-muted">{suggestion.companyName} · </span>
      ) : null}
      {suggestion.headline}
    </>
  );

  return (
    <li className="group/row row-pad space-y-1.5">
      <div className="space-y-0.5">
        <h3 className="text-ui font-medium text-ink">
          {suggestion.url ? (
            <a
              href={suggestion.url}
              target="_blank"
              rel="noreferrer"
              className="group/title hover:text-accent"
            >
              {title}
              <ExternalLink
                className="ml-1 inline size-3.5 align-[-2px] text-ink-ghost group-hover/title:text-accent"
                strokeWidth={1.75}
                aria-label="Opens the posting"
              />
            </a>
          ) : (
            title
          )}
        </h3>
        <RoleFacts suggestion={suggestion} />
      </div>
      <p className="line-clamp-2 text-ui text-ink group-has-[details[open]]/row:line-clamp-none">
        {suggestion.why}
      </p>

      <div className="flex flex-wrap items-center gap-2 has-[>details[open]]:flex-col has-[>details[open]]:items-stretch">
        <details className="group/details min-w-0">
          <summary
            className={cn(
              'press flex w-fit cursor-pointer list-none items-center gap-1 rounded-control text-small font-medium',
              'text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden',
            )}
          >
            <ChevronRight
              className="size-3.5 transition-transform duration-150 group-open/details:rotate-90"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="group-open/details:hidden">Details</span>
            <span className="hidden group-open/details:inline">Less</span>
          </summary>
          <div className="mt-2 space-y-2">
            <ScoreReasons note={suggestion.scoreNote} />
            <OpeningAnswers suggestion={suggestion} />
            {steps ? (
              <ol className="list-decimal space-y-0.5 pl-5 text-ui text-ink">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="whitespace-pre-line text-ui text-ink">
        <LinkedText text={suggestion.move} />
      </p>
            )}
            {suggestion.foundIn && (
              <p className="text-small text-ink-muted">{suggestion.foundIn}</p>
            )}
          </div>
        </details>
        <span className="ml-auto flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
          >
            Not for me
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pending={busy}
            onClick={() => act(() => saveOpening(suggestion.id))}
          >
            Save as lead
          </Button>
        </span>
      </div>
      {choosing && (
        <div
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-small"
          role="group"
          aria-label="Why not this one"
        >
          <span className="text-ink-muted">Why not?</span>
          {DISMISS_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              disabled={busy}
              onClick={() => act(() => dismissOpening(suggestion.id, reason))}
              className="press rounded-control text-ink underline decoration-border underline-offset-2 hover:decoration-ink disabled:opacity-50"
            >
              {DISMISS_REASON_LABELS[reason]}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-small text-danger">{error}</p>}
    </li>
  );
}
