'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { Field, FieldError, Textarea, Input } from '@/components/ui/field';
import { formatCompBand, formatDateTime } from '@/lib/jobs/applications/load';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import { lookUpJobDescription, updateRole, type JdLookupResult } from '../actions';
import { matchRoleRequirements, rebuildRequirementMap } from './posting-actions';
import { PaidHint } from '@/components/ui/paid-hint';
import { LinkedText } from '@/components/ui/linked-text';
import type { PanelProps } from './types';
import { VERDICT_STYLE } from './verdict';

export function Posting({
  roleId,
  jdText,
  jdLookupNote,
  jdUrl,
  atsJobId,
  compMinCents,
  compMaxCents,
  compSource,
  requirements,
  requirementMatches,
  requirementMatchesAt,
  requirementMatchesStale,
  bankSize,
  timezone,
}: PanelProps) {
  const groups: Array<{ kind: Requirement['kind']; label: string }> = [
    { kind: 'must_have', label: 'Must have' },
    { kind: 'nice_to_have', label: 'Nice to have' },
    { kind: 'responsibility', label: 'What the role does' },
  ];

  const [matches, setMatches] = useState(requirementMatches);
  const [stale, setStale] = useState(requirementMatchesStale);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [, startMatch] = useTransition();

  // The map itself, which the page can now rebuild without the description
  // being retyped. Held here for the same reason the matches are: the answer
  // comes back from the action and the panel should not need a reload to draw
  // it.
  const [lines, setLines] = useState(requirements);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [, startRead] = useTransition();

  const rebuild = () => {
    setReading(true);
    setReadNote(null);
    setMatchError(null);
    startRead(async () => {
      const result = await rebuildRequirementMap({ roleId });
      setReading(false);
      if (result.error || !result.requirements) {
        setMatchError(result.error ?? 'The description could not be read.');
        return;
      }
      setLines(result.requirements);
      // A parser that found nothing has to say so. Silence here is what made
      // the empty map look like a stale one.
      setReadNote(
        result.requirements.length === 0
          ? 'Read the description and found no requirement lines in it.'
          : `Read ${result.requirements.length} line${result.requirements.length === 1 ? '' : 's'} out of the description.`,
      );
    });
  };

  // Keyed by text, because the map is stored as its own list and a description
  // re-extracted since the match can have moved, added or dropped a line. A
  // line with no entry simply renders unmatched, which is the honest reading.
  const verdictFor = new Map((matches ?? []).map((match) => [match.requirement, match]));

  return (
    // One column, in reading order: what the role is, what it says, then what
    // you can claim against it.
    <div className="space-y-4">
      <RoleDetailsCard
        roleId={roleId}
        jdUrl={jdUrl}
        atsJobId={atsJobId}
        compMinCents={compMinCents}
        compMaxCents={compMaxCents}
        compSource={compSource}
        jdText={jdText}
      />

      <JobDescriptionCard roleId={roleId} jdText={jdText} jdLookupNote={jdLookupNote} />

      <CardSection
        title="Requirement map"
        hint={
          matches
            ? 'Your best evidence beside each line. A gap is the useful answer — it is the hour you do not spend.'
            : 'Extracted once from the description. Match it against your bank to see which lines you can actually claim.'
        }
        action={
          // At phone width the buttons wrap under the heading; the ghost
          // button's padding is taken back so its words start on the card's
          // edge with the heading's (law 18).
          <div className={cn('flex items-center gap-1', jdText.trim() && '-ml-2.5 sm:ml-0')}>
            {/* Reading the description again is free and is the only way back
                from an empty map -- a parser that could not read a posting
                when it was pasted may well read it now. Offered whenever
                there is a description, and named for what it does to the map
                rather than for the paragraph it reads. */}
            {jdText.trim() && (
              <Button type="button" size="sm" variant="ghost" pending={reading} onClick={rebuild}>
                {reading ? 'Reading…' : lines.length === 0 ? 'Build the map' : 'Read it again'}
              </Button>
            )}
            {lines.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                pending={matching}
                onClick={() => {
                  setMatching(true);
                  setMatchError(null);
                  startMatch(async () => {
                    const result = await matchRoleRequirements({ roleId });
                    setMatching(false);
                    if (result.error || !result.matches) {
                      setMatchError(result.error ?? 'The match came back empty.');
                      return;
                    }
                    setMatches(result.matches);
                    setStale(false);
                  });
                }}
              >
                {matching ? 'Matching…' : matches ? 'Match again' : 'Match my evidence'}
              </Button>
            )}
            {lines.length > 0 && (
              <PaidHint
                action="app/jobs/(app)/roles/[id]/posting-actions.ts#matchRoleRequirements"
                what="Cost of matching"
              />
            )}
          </div>
        }
      >
        {matches && requirementMatchesAt && !stale && (
          <p className="mt-1 text-small text-ink-muted">
            Matched {formatDateTime(requirementMatchesAt, timezone)}.
          </p>
        )}
        {stale && (
          <p className="mt-1 text-small text-caution">
            The description or your bank has changed since this was matched.
          </p>
        )}
        {bankSize === 0 && (
          <p className="mt-1 text-small text-ink-muted">
            Your evidence bank is empty, so there is nothing to match against.{' '}
            <Link
              href="/jobs/material?part=evidence"
              className="underline underline-offset-2 transition-colors duration-quick hover:text-ink"
            >
              Fill it in Material.
            </Link>
          </p>
        )}
        {readNote && <p className="mt-1 text-small text-ink-muted">{readNote}</p>}
        <FieldError>{matchError}</FieldError>

        {lines.length === 0 ? (
          // Two different nothings, and calling both of them "no description"
          // is how a role with six thousand characters of posting on the same
          // page came to be reported as missing one -- law 2.
          <p className="mt-3 text-ui text-ink-muted">
            {jdText.trim()
              ? 'The description is saved but no requirement lines have been read out of it. Build the map to read it again.'
              : 'No description saved yet, so there is nothing to map.'}
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {groups.map((group) => {
              const items = lines.filter((r) => r.kind === group.kind);
              if (items.length === 0) return null;
              return (
                <div key={group.kind}>
                  <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
                    {group.label}
                  </h4>
                  <ul className="mt-1 space-y-1">
                    {items.map((item, index) => {
                      const match = verdictFor.get(item.text);
                      const style = match ? VERDICT_STYLE[match.verdict] : null;
                      return (
                        <li key={`${group.kind}-${index}`} className="flex gap-2 text-ui text-ink">
                          <span
                            className={cn(
                              'mt-1.5 size-1.5 shrink-0 rounded-full',
                              style ? style.dot : 'bg-border-strong',
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0">
                            {item.text}
                            {match && style && (
                              <span className="block text-small text-ink-muted">
                                <span className={cn('font-medium', style.text)}>{style.label}</span>
                                {' — '}
                                {match.why}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </CardSection>
    </div>
  );
}

/**
 * The link, the ATS requisition id, and the comp band -- editable, because
 * none of them arrive from mail as reliably as the description itself does.
 *
 * "Look it up" lives here rather than on the description below it. Three of
 * the fields on this card are what the board fills -- the posting link, the
 * requisition id and the comp band -- so this is where you are standing when
 * you notice they are blank and want them found. It was on the description
 * card because the description is the largest thing the lookup writes, which
 * is a fact about the implementation rather than about the person reading a
 * row of dashes.
 */
function RoleDetailsCard({
  roleId,
  jdUrl,
  atsJobId,
  compMinCents,
  compMaxCents,
  compSource,
  jdText,
}: {
  roleId: string;
  jdUrl: string | null;
  atsJobId: string | null;
  compMinCents: number | null;
  compMaxCents: number | null;
  compSource: string | null;
  /** Only to know whether the lookup is offered: it never overwrites one. */
  jdText: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [jdUrlDraft, setJdUrlDraft] = useState(jdUrl ?? '');
  const [atsJobIdDraft, setAtsJobIdDraft] = useState(atsJobId ?? '');
  const [compMinDraft, setCompMinDraft] = useState(
    compMinCents !== null ? String(Math.round(compMinCents / 100)) : '',
  );
  const [compMaxDraft, setCompMaxDraft] = useState(
    compMaxCents !== null ? String(Math.round(compMaxCents / 100)) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lookup, setLookup] = useState<JdLookupResult | null>(null);
  const [looking, startLooking] = useTransition();

  const compBand = formatCompBand(compMinCents, compMaxCents);

  // The nightly pass walks six companies a night. A role you are looking at now
  // should not wait behind two hundred you are not, and the answer arrives in
  // about the time the board takes to reply.
  const lookItUp = () => {
    setLookup(null);
    startLooking(async () => {
      setLookup(await lookUpJobDescription(roleId));
      router.refresh();
    });
  };

  const save = () => {
    setError(null);
    const min = compMinDraft.trim() ? Math.round(Number(compMinDraft) * 100) : null;
    const max = compMaxDraft.trim() ? Math.round(Number(compMaxDraft) * 100) : null;
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
      setError('Compensation has to be a number.');
      return;
    }
    startTransition(async () => {
      const result = await updateRole(roleId, {
        jdUrl: jdUrlDraft.trim() || null,
        atsJobId: atsJobIdDraft.trim() || null,
        compMinCents: min,
        compMaxCents: max,
        compSource:
          min !== null || max !== null
            ? ((compSource ?? 'recruiter') as 'posted' | 'recruiter' | 'estimate')
            : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <CardSection
        title="Details"
        action={
          <div className="flex items-center gap-1">
            {/* Offered only on a role with no description, which is the one
                rule the action itself enforces: the board's text would replace
                anything pasted here, and automated work never argues with
                what a person wrote. */}
            {!jdText && (
              <Button type="button" size="sm" variant="ghost" pending={looking} onClick={lookItUp}>
                {looking ? 'Looking…' : 'Look it up'}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Edit posting details"
              className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink"
            >
              <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Edit posting details</span>
            </button>
          </div>
        }
      >
        <dl className="space-y-1.5 text-ui">
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-muted">Posting link</dt>
            <dd className="min-w-0 flex-1 truncate">
              {jdUrl ? (
                <a
                  href={jdUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent underline underline-offset-2 transition-colors duration-quick hover:text-accent-hover"
                >
                  {jdUrl}
                </a>
              ) : (
                <span className="text-ink-muted">—</span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-muted">ATS job id</dt>
            <dd className="text-ink">{atsJobId ?? <span className="text-ink-muted">—</span>}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-muted">Compensation</dt>
            <dd className="text-ink">
              {compBand ?? <span className="text-ink-muted">—</span>}
              {compBand && compSource && (
                <span className="ml-1.5 text-small text-ink-muted">from the {compSource}</span>
              )}
            </dd>
          </div>
        </dl>

        {/* What this lookup just did, beside the button that did it. */}
        {lookup && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-small text-ink-muted">{lookup.message}</p>
            {/* The ambiguous case is the one worth spending pixels on: the
                board knows which postings these are, so linking them turns "go
                and find it" into one click away from the right page. */}
            {lookup.candidates && lookup.candidates.length > 0 && (
              <ul className="mt-2 space-y-1">
                {lookup.candidates.map((candidate) => (
                  <li key={`${candidate.title}-${candidate.url ?? ''}`} className="text-small">
                    {candidate.url ? (
                      <a
                        href={candidate.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-ink-muted underline underline-offset-2 transition-colors duration-quick hover:text-ink"
                      >
                        {candidate.title}
                      </a>
                    ) : (
                      <span className="text-ink-muted">{candidate.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardSection>
    );
  }

  return (
    <CardSection title="Details">
      <div className="space-y-2">
        <Field id={`jdurl-${roleId}`} label="Posting link">
          <Input
            type="url"
            value={jdUrlDraft}
            onChange={(event) => setJdUrlDraft(event.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field id={`ats-${roleId}`} label="ATS job id">
          <Input value={atsJobIdDraft} onChange={(event) => setAtsJobIdDraft(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id={`compmin-${roleId}`} label="Comp min ($)">
            <Input
              type="number"
              value={compMinDraft}
              onChange={(event) => setCompMinDraft(event.target.value)}
            />
          </Field>
          <Field id={`compmax-${roleId}`} label="Comp max ($)">
            <Input
              type="number"
              value={compMaxDraft}
              onChange={(event) => setCompMaxDraft(event.target.value)}
            />
          </Field>
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" pending={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </CardSection>
  );
}

/**
 * The description itself. Pasting one re-extracts the requirement map and,
 * when the text has a visible range in it, fills the comp band too -- see
 * updateRole.
 */
function JobDescriptionCard({
  roleId,
  jdText,
  jdLookupNote,
}: {
  roleId: string;
  jdText: string;
  jdLookupNote: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(jdText);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateRole(roleId, { jdText: draft });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <CardSection
      title="Job description"
      action={
        !editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(jdText);
              setEditing(true);
            }}
          >
            {jdText ? 'Edit' : 'Add description'}
          </Button>
        )
      }
    >
      {editing ? (
        <div>
          <Textarea
            autoFocus
            rows={16}
            value={draft}
            aria-label="Job description"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste the full posting here."
          />
          <FieldError>{error}</FieldError>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" pending={pending} onClick={save}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : jdText ? (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap font-sans text-ui leading-relaxed text-ink-muted">
          <LinkedText text={jdText} />
        </pre>
      ) : (
        <p className="text-ui text-ink-muted">
          Nothing saved. Paste it here, or press Look it up under Details to read it off the
          employer&rsquo;s own board. Either builds the requirement map and fills in the comp band.
        </p>
      )}

      {/* Why a board lookup did not fill this in, or which posting it picked
          when the match was on a title rather than an id. An empty panel on its
          own asks you for nothing and explains nothing. Hidden while editing,
          where the box you are typing in is the answer.

          What a lookup you just pressed did is reported under Details, beside
          the button -- this is the stored note, which that press replaces on
          the next render. */}
      {!editing && jdLookupNote && (
        <p className="mt-3 border-t border-border pt-3 text-small text-ink-muted">{jdLookupNote}</p>
      )}
    </CardSection>
  );
}
