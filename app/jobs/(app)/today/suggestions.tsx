'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Copy, ExternalLink, Mail, Sparkles } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import { gmailComposeUrl } from '@/lib/jobs/followup/compose';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import { splitSubject } from '@/lib/jobs/suggest/payload';
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
  event: 'At an event',
  other: 'Message',
};

/**
 * What Dash suggests doing next: people to contact, with the message written,
 * and open postings it found. The daily run fills it (lib/jobs/suggest); the
 * two buttons ask for more now.
 */
export function Suggestions({ suggestions }: { suggestions: OpenSuggestion[] }) {
  const [pending, run] = useTransition();
  const [which, setWhich] = useState<'people' | 'roles' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ask = (kind: 'people' | 'roles', action: () => Promise<SuggestState>) => {
    setNotice(null);
    setWhich(kind);
    run(async () => {
      const result = await action();
      setNotice(result.error ?? result.message ?? null);
    });
  };

  const people = suggestions.filter((s) => s.kind === 'reach_out');
  const roles = suggestions.filter((s) => s.kind === 'apply');

  return (
    <Card padding="dense">
      <header className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <Sparkles className="size-4 self-center text-accent" strokeWidth={1.75} aria-hidden />
          <h2 className="text-ui font-semibold text-ink">Dash suggests</h2>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pending={pending && which === 'people'}
            disabled={pending}
            onClick={() => ask('people', suggestPeople)}
          >
            {pending && which === 'people' ? 'Choosing…' : 'Who to contact'}
          </Button>
          <PaidHint action="app/jobs/(app)/today/actions.ts#suggestPeople" what="Cost of choosing people" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pending={pending && which === 'roles'}
            disabled={pending}
            onClick={() => ask('roles', suggestOpenings)}
          >
            {pending && which === 'roles' ? 'Searching…' : 'Find roles'}
          </Button>
          <PaidHint action="app/jobs/(app)/today/actions.ts#suggestOpenings" what="Cost of a search for roles" align="end" />
        </span>
      </header>
      <p className="mb-2 text-small text-ink-muted">
        {suggestions.length > 0
          ? 'People worth a message this week, with what to say, and open roles that fit what you wrote.'
          : 'Dash checks every few days for people worth contacting and once a week for open roles that fit your career goals.'}
      </p>
      {notice && <p className="mb-2 text-small text-ink-muted">{notice}</p>}

      {people.length > 0 && (
        <ul className="divide-y divide-border">
          {people.map((suggestion) => (
            <PersonRow key={suggestion.id} suggestion={suggestion} />
          ))}
        </ul>
      )}

      {roles.length > 0 && (
        <>
          {people.length > 0 && <h3 className="mt-3 mb-1 text-small font-medium text-ink-muted">Roles to apply for</h3>}
          <ul className="divide-y divide-border">
            {roles.map((suggestion) => (
              <RoleRow key={suggestion.id} suggestion={suggestion} />
            ))}
          </ul>
        </>
      )}
    </Card>
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
