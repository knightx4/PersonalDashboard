'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { ChevronDown, Copy, ExternalLink, Mail, Search, Sparkles } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { PaidHint } from '@/components/ui/paid-hint';
import { ScoreChips, ScoreReasons } from '@/components/jobs/ui/score-figures';
import { CHANCE_BAND_LABELS } from '@/lib/jobs/suggest/chance-check';
import { FIT_MINIMUMS } from '@/lib/jobs/suggest/score-notes';
import { gmailComposeUrl } from '@/lib/jobs/followup/compose';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import { linkedinSearchUrl, splitSubject } from '@/lib/jobs/suggest/payload';
import {
  NO_OPENING_FILTER,
  OPENING_SORT_LABELS,
  OPENING_SORTS,
  passesFilter,
  scoreChips,
  sortOpenings,
  WORKPLACE_LABELS,
  type OpeningFilter,
  type OpeningSort,
  type Workplace,
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
  hint: string;
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
  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [status?.running, router]);
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
      <header className={cn('flex flex-wrap items-center justify-between gap-2', !folded && 'mb-1')}>
        <button
          type="button"
          onClick={fold}
          aria-expanded={!folded}
          title={folded ? `Show ${title.toLowerCase()}` : `Fold ${title.toLowerCase()}`}
          className="press flex items-baseline gap-2 rounded-control text-left"
        >
          <ChevronDown
            className={cn('size-3.5 self-center text-ink-muted transition-transform duration-150', folded && '-rotate-90')}
            strokeWidth={1.75}
            aria-hidden
          />
          <Sparkles className="size-4 self-center text-accent" strokeWidth={1.75} aria-hidden />
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
          <p className="mb-2 text-small text-ink-muted">{count > 0 ? hint : empty}</p>
          {status && (
            <p
              role="status"
              className={cn('mb-2 text-small', status.tone === 'warn' ? 'text-caution' : 'text-ink-muted')}
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
        <PaidHint action="app/jobs/(app)/recommend/actions.ts#suggestPeople" what="Cost of a search for people" align="end" />
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
  stats = [],
  searchCostMicros = 0,
  searchLine = null,
}: {
  suggestions: OpenSuggestion[];
  /** How the latest roles search went (search-runs.ts `describeRun`). */
  searchLine?: RunLine | null;
  /** Each source's record (lib/jobs/suggest/stats.ts). */
  stats?: OriginStats[];
  /** What the web searches have cost in all, in micro-dollars. */
  searchCostMicros?: number;
}) {
  const [sort, setSort] = useState<OpeningSort>('newest');
  const [filter, setFilter] = useState<OpeningFilter>(NO_OPENING_FILTER);
  const shown = useMemo(
    () => sortOpenings(suggestions.filter((s) => passesFilter(s, filter)), sort),
    [suggestions, filter, sort],
  );
  const scored = suggestions.some((s) => s.scores);

  return (
    <RecommendedSection
      title="Recommended roles"
      hint="Open postings that fit your career goals, from Dash's weekly search, the job boards of companies you follow, and anything a goal step turned up. Dash reads each posting and takes it off once it closes. Save one to add it to your pipeline as a lead."
      empty="Dash searches for open roles every week, from your career goals, CV and the boards of companies you follow. The next ones will appear here."
      button="Search now"
      searching="Searching…"
      paidHint={
        <PaidHint action="app/jobs/(app)/recommend/actions.ts#suggestOpenings" what="Cost of a search for roles" align="end" />
      }
      action={suggestOpenings}
      count={suggestions.length}
      footer={<SourceStats stats={stats} searchCostMicros={searchCostMicros} />}
      status={searchLine}
      toolbar={
        scored ? (
          <OpeningControls
            sort={sort}
            onSort={setSort}
            filter={filter}
            onFilter={setFilter}
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
 * Sort and filter the recommended roles by Jev's answers (plan #1178). Held
 * in the page rather than the URL: the table below owns the URL's filters,
 * and these narrow only the list above it. An opening not yet scored passes
 * every filter.
 */
function OpeningControls({
  sort,
  onSort,
  filter,
  onFilter,
  shown,
  total,
}: {
  sort: OpeningSort;
  onSort: (sort: OpeningSort) => void;
  filter: OpeningFilter;
  onFilter: (filter: OpeningFilter) => void;
  shown: number;
  total: number;
}) {
  const set = (patch: Partial<OpeningFilter>) => onFilter({ ...filter, ...patch });
  const narrowed = JSON.stringify(filter) !== JSON.stringify(NO_OPENING_FILTER);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-small">
      <ChipSelect aria-label="Sort recommended roles" value={sort} onChange={(e) => onSort(e.target.value as OpeningSort)}>
        {OPENING_SORTS.map((value) => (
          <option key={value} value={value}>
            {OPENING_SORT_LABELS[value]}
          </option>
        ))}
      </ChipSelect>
      <ChipSelect
        aria-label="Filter by workplace"
        placeholderValue="any"
        value={filter.workplace}
        onChange={(e) => set({ workplace: e.target.value as Workplace | 'any' })}
      >
        <option value="any">Any workplace</option>
        {(['remote', 'hybrid', 'on_site'] as const).map((value) => (
          <option key={value} value={value}>
            {WORKPLACE_LABELS[value]}
          </option>
        ))}
      </ChipSelect>
      <ChipSelect
        aria-label="Filter by match to your evidence"
        placeholderValue="any"
        value={filter.fit}
        onChange={(e) => set({ fit: e.target.value as OpeningFilter['fit'] })}
      >
        <option value="any">Any match</option>
        <option value="strong">Strong match</option>
        <option value="partial_up">Partial or strong match</option>
      </ChipSelect>
      <ChipSelect
        aria-label="Filter by salary"
        placeholderValue="any"
        value={filter.salary ? 'shown' : 'any'}
        onChange={(e) => set({ salary: e.target.value === 'shown' })}
      >
        <option value="any">Any pay</option>
        <option value="shown">Salary shown</option>
      </ChipSelect>
      <ChipSelect
        aria-label="Filter by cover letter"
        placeholderValue="any"
        value={filter.coverLetter}
        onChange={(e) => set({ coverLetter: e.target.value as OpeningFilter['coverLetter'] })}
      >
        <option value="any">Cover letter or not</option>
        <option value="yes">Asks for a cover letter</option>
        <option value="no">No cover letter</option>
      </ChipSelect>
      <ChipSelect
        aria-label="Lowest fit to show"
        placeholderValue="0"
        value={String(filter.minFit)}
        onChange={(e) => set({ minFit: Number(e.target.value) })}
      >
        <option value="0">Any fit</option>
        {FIT_MINIMUMS.map((value) => (
          <option key={value} value={value}>
            Fit {value} and up
          </option>
        ))}
      </ChipSelect>
      <ChipSelect
        aria-label="Lowest chance of an interview to show"
        placeholderValue="any"
        value={filter.minChance}
        onChange={(e) => set({ minChance: e.target.value as OpeningFilter['minChance'] })}
      >
        <option value="any">Any chance of an interview</option>
        <option value="medium">{CHANCE_BAND_LABELS.medium} chance of an interview or better</option>
        <option value="high">{CHANCE_BAND_LABELS.high} chance of an interview</option>
      </ChipSelect>
      <ChipSelect
        aria-label="Red flags"
        placeholderValue="show"
        value={filter.hideRedFlags ? 'hide' : 'show'}
        onChange={(e) => set({ hideRedFlags: e.target.value === 'hide' })}
      >
        <option value="show">With red flags</option>
        <option value="hide">Without red flags</option>
      </ChipSelect>
      <ChipSelect
        aria-label="Roles already on file"
        placeholderValue="show"
        value={filter.hideDuplicates ? 'hide' : 'show'}
        onChange={(e) => set({ hideDuplicates: e.target.value === 'hide' })}
      >
        <option value="show">With ones on file</option>
        <option value="hide">New to you only</option>
      </ChipSelect>
      {narrowed && (
        <>
          <span className="tabular ml-1 text-ink-muted">
            {shown} of {total}
          </span>
          <button
            type="button"
            onClick={() => onFilter(NO_OPENING_FILTER)}
            className="ml-1 font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}

/**
 * How each source of recommended roles has done: found, saved, applied,
 * reached an interview, turned down, and for the paid search what it cost.
 * Folded by default; it is for deciding whether the search earns its keep,
 * not for every visit.
 */
function SourceStats({ stats, searchCostMicros }: { stats: OriginStats[]; searchCostMicros: number }) {
  if (stats.length === 0) return null;
  return (
    <details className="mt-2 border-t border-border pt-2 text-small text-ink-muted">
      <summary className="press cursor-pointer rounded-control font-medium">Where these come from</summary>
      <ul className="mt-1.5 space-y-1">
        {stats.map((line) => (
          <li key={line.origin} className="tabular">
            <span className="font-medium text-ink">{OPENING_ORIGIN_LABELS[line.origin]}</span>: {line.found} found,{' '}
            {line.saved} saved, {line.applied} applied, {line.interviews}{' '}
            {line.interviews === 1 ? 'interview' : 'interviews'}, {line.dismissed} turned down
            {line.expired > 0 ? `, ${line.expired} closed or dropped` : ''}
            {line.origin === 'search' && searchCostMicros > 0 ? `. Searches cost ${formatCost(searchCostMicros)} so far` : ''}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Jev's eight answers as a line of short labels; an unsure one carries a question mark. */
function OpeningAnswers({ suggestion }: { suggestion: OpenSuggestion }) {
  const misses = suggestion.misses ?? [];
  if (!suggestion.scores && misses.length === 0) return <p className="text-small text-ink-ghost">Not scored yet</p>;
  const chips = suggestion.scores ? scoreChips(suggestion.scores) : [];
  if (chips.length === 0 && misses.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Dash's answers about this opening">
      {misses.map((miss) => (
        <li key={miss} className="rounded-control bg-caution-tint px-1.5 py-0.5 text-small text-caution">
          {miss}
        </li>
      ))}
      {chips.map((chip) => (
        <li
          key={chip.key}
          title={chip.unsure ? 'Dash is not sure of this one' : undefined}
          className={cn(
            'rounded-control px-1.5 py-0.5 text-small',
            chip.tone === 'warn' ? 'bg-caution-tint text-caution' : chip.tone === 'good' ? 'bg-accent-tint text-accent' : 'bg-sunken text-ink-muted',
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
              <Link href={`/jobs/companies/${suggestion.companySlug}`} className="hover:text-accent">
                {suggestion.companyName}
              </Link>
            ) : (
              suggestion.companyName
            )}
          </span>
        )}
        {suggestion.channel && (
          <span className="text-small text-ink-muted">{CHANNEL_LABELS[suggestion.channel] ?? 'Message'}</span>
        )}
      </div>
      <p className="text-small text-ink-muted">{suggestion.why}</p>
      {suggestion.foundIn && <p className="text-small text-ink-muted">{suggestion.foundIn}</p>}
      <p className="whitespace-pre-line text-ui text-ink">{suggestion.move}</p>
      {message && (
        <div className="rounded-card bg-canvas p-3">
          {email?.subject && <p className="mb-1 text-small font-medium text-ink">Subject: {email.subject}</p>}
          <p className="whitespace-pre-wrap text-ui leading-relaxed text-ink">{email ? email.body : message}</p>
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
          <Button type="button" size="sm" variant="ghost" pending={busy} onClick={() => act(() => dismissSuggestion(suggestion.id))}>
            Not now
          </Button>
          <Button type="button" size="sm" pending={busy} onClick={() => act(() => markSuggestionSent(suggestion.id))}>
            Sent
          </Button>
        </span>
      </div>
      {error && <p className="text-small text-danger">{error}</p>}
    </li>
  );
}

function RoleRow({ suggestion }: { suggestion: OpenSuggestion }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Not for me asks why before it turns the role down: the reason is what
  // the next search learns from (lib/jobs/suggest/feedback.ts).
  const [choosing, setChoosing] = useState(false);

  const act = (action: () => Promise<{ error: string | null }>) =>
    start(async () => {
      const result = await action();
      setError(result.error);
    });

  return (
    <li className="row-pad space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-ui font-medium text-ink">
          {suggestion.companyName ? `${suggestion.companyName} · ` : ''}
          {suggestion.headline}
        </span>
        {suggestion.location && <span className="text-small text-ink-muted">{suggestion.location}</span>}
        <ScoreChips note={suggestion.scoreNote} />
      </div>
      <ScoreReasons note={suggestion.scoreNote} />
      <OpeningAnswers suggestion={suggestion} />
      <p className="text-small text-ink-muted">{suggestion.why}</p>
      {suggestion.foundIn && <p className="text-small text-ink-muted">{suggestion.foundIn}</p>}
      <p className="whitespace-pre-line text-ui text-ink">{suggestion.move}</p>
      <div className="flex flex-wrap items-center gap-2">
        {suggestion.url && (
          <a
            href={suggestion.url}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
            Open posting
          </a>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
          >
            Not for me
          </Button>
          <Button type="button" size="sm" pending={busy} onClick={() => act(() => saveOpening(suggestion.id))}>
            Save as lead
          </Button>
        </span>
      </div>
      {choosing && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Why not this one">
          <span className="text-small text-ink-muted">Why not?</span>
          {DISMISS_REASONS.map((reason) => (
            <Button
              key={reason}
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => act(() => dismissOpening(suggestion.id, reason))}
            >
              {DISMISS_REASON_LABELS[reason]}
            </Button>
          ))}
        </div>
      )}
      {error && <p className="text-small text-danger">{error}</p>}
    </li>
  );
}
