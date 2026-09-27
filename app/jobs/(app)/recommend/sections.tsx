'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Copy, ExternalLink, Mail, Search, Sparkles } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import { gmailComposeUrl } from '@/lib/jobs/followup/compose';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import { linkedinSearchUrl, splitSubject } from '@/lib/jobs/suggest/payload';
import {
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
  searching,
  paidHint,
  action,
  count,
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
  children: React.ReactNode;
}) {
  const [pending, run] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const ask = () => {
    setNotice(null);
    run(async () => {
      const result = await action();
      setNotice(result.error ?? result.message ?? null);
    });
  };

  return (
    <Card padding="dense">
      <header className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <Sparkles className="size-4 self-center text-accent" strokeWidth={1.75} aria-hidden />
          <h2 className="text-ui font-semibold text-ink">{title}</h2>
          {count > 0 && <span className="tabular text-small text-ink-muted">{count}</span>}
        </span>
        <span className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" pending={pending} onClick={ask}>
            {pending ? searching : button}
          </Button>
          {paidHint}
        </span>
      </header>
      <p className="mb-2 text-small text-ink-muted">{count > 0 ? hint : empty}</p>
      {notice && <p className="mb-2 text-small text-ink-muted">{notice}</p>}
      {count > 0 && <ul className="divide-y divide-border">{children}</ul>}
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

export function RecommendedRoles({ suggestions }: { suggestions: OpenSuggestion[] }) {
  return (
    <RecommendedSection
      title="Recommended roles"
      hint="Open postings that fit your career goals, from Dash's searches and anything a goal step turned up. Save one to add it to your pipeline as a lead."
      empty="Dash searches for open roles every week, from your career goals and CV. The next ones will appear here."
      button="Search now"
      searching="Searching…"
      paidHint={
        <PaidHint action="app/jobs/(app)/recommend/actions.ts#suggestOpenings" what="Cost of a search for roles" align="end" />
      }
      action={suggestOpenings}
      count={suggestions.length}
    >
      {suggestions.map((suggestion) => (
        <RoleRow key={suggestion.id} suggestion={suggestion} />
      ))}
    </RecommendedSection>
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
      </div>
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
          <Button type="button" size="sm" variant="ghost" pending={busy} onClick={() => act(() => dismissSuggestion(suggestion.id))}>
            Not for me
          </Button>
          <Button type="button" size="sm" pending={busy} onClick={() => act(() => saveOpening(suggestion.id))}>
            Save as lead
          </Button>
        </span>
      </div>
      {error && <p className="text-small text-danger">{error}</p>}
    </li>
  );
}
