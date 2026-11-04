'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { MessagingPanel, PersonMark } from '@/components/patterns/messaging';
import { Button, buttonVariants } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { DashMark } from '@/components/ui/dash-mark';
import { Field, FieldError, Input, Label, Switch, Textarea } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { SectionLabel } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { whenDate } from '@/lib/core/when';
import { MENTOR_PALETTE, personInitials, threadHref } from '@/lib/you/chat-threads-model';
import type { CouncilMemory } from '@/lib/you/council-model';
import {
  ASK_MAX,
  BUBBLE_LABELS,
  BUBBLES,
  CARES_MAX,
  LENGTH_LABELS,
  LENGTHS,
  MEMORY_LINE_MAX,
  NEVER_MAX,
  PERSON_NAME_MAX,
  PERSONA_MAX,
  TONE_MAX,
  WHO_MAX,
  type PersonBrief,
  type PersonCard,
  type PersonaVersion,
} from '@/lib/you/people-cards-model';

/**
 * Adding someone to People, or editing anyone already there (plan #2748.11):
 * one form for both, in the thread's place beside the list.
 *
 * Name, colour and who they are; how they talk (length, how many texts,
 * tone); what they care about and never say. Then the persona card every
 * reply reads: Dash drafts it from the form for someone new, and for someone
 * there already it can be edited directly or redrafted from a sentence.
 * Earlier cards can be brought back into the box, and saving keeps the one
 * it replaces. What they remember is corrected or removed line by line,
 * each at once, with a confirm before a line goes.
 */

export type PersonFormActions = {
  save: (input: {
    advisorId: string;
    name: string;
    colour: string;
    brief: PersonBrief;
    persona: string;
    joinsMeetings: boolean;
    author: { by: 'you' | 'dash'; ask: string | null };
  }) => Promise<{ key: string } | { error: string }>;
  draft: (input: { name: string; brief: PersonBrief; current?: string | null; ask?: string | null }) => Promise<{ card: string } | { error: string }>;
  correct: (id: string, text: string) => Promise<{ error: string | null }>;
  remove: (id: string) => Promise<{ error: string | null }>;
};

/** The gallery's presses: nothing is saved. */
const NO_ACTIONS: PersonFormActions = {
  save: async () => ({ error: 'The gallery saves nothing.' }),
  draft: async () => ({ error: 'The gallery drafts nothing.' }),
  correct: async () => ({ error: null }),
  remove: async () => ({ error: null }),
};

type Drafted = { card: string; ask: string | null };

export function PersonForm({
  card,
  timezone,
  now,
  actions = NO_ACTIONS,
  drafting: initialDrafting = false,
  draftError: initialDraftError = null,
  removing = null,
  editing = null,
  scrollTo = null,
}: {
  card: PersonCard;
  timezone: string;
  now: number;
  actions?: PersonFormActions;
  /** For the gallery: Dash writing the card. */
  drafting?: boolean;
  /** For the gallery: a draft that failed. */
  draftError?: string | null;
  /** For the gallery: the memory line whose remove is being confirmed. */
  removing?: string | null;
  /** For the gallery: the memory line being corrected. */
  editing?: string | null;
  /** For the gallery: open scrolled to a part further down. */
  scrollTo?: 'card' | 'versions' | 'memory' | null;
}) {
  const router = useRouter();
  const adding = !card.id;
  const [name, setName] = useState(card.name);
  const [colour, setColour] = useState(card.colour);
  const [brief, setBrief] = useState<PersonBrief>(card.brief);
  const [persona, setPersona] = useState(card.persona);
  const [joins, setJoins] = useState(card.joinsMeetings);
  const [ask, setAsk] = useState('');
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [drafting, setDrafting] = useState(initialDrafting);
  const [draftError, setDraftError] = useState<string | null>(initialDraftError);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const back = adding ? '/chat' : threadHref(card.key);
  const set = <K extends keyof PersonBrief>(key: K, value: PersonBrief[K]) => setBrief((b) => ({ ...b, [key]: value }));

  const draft = async (redraft: boolean) => {
    setDrafting(true);
    setDraftError(null);
    const sentence = redraft ? ask.trim() : '';
    const result = await actions.draft({ name, brief, current: redraft ? persona : null, ask: sentence || null });
    setDrafting(false);
    if ('error' in result) {
      setDraftError(result.error);
      return;
    }
    setPersona(result.card);
    setDrafted({ card: result.card, ask: sentence || null });
    setAsk('');
  };

  const save = () => {
    setSaveError(null);
    startSave(async () => {
      const author = drafted && drafted.card === persona.trim() ? { by: 'dash' as const, ask: drafted.ask } : { by: 'you' as const, ask: null };
      const result = await actions.save({ advisorId: card.id, name, colour, brief, persona, joinsMeetings: joins, author });
      if ('error' in result) {
        setSaveError(result.error);
        return;
      }
      router.push(threadHref(result.key));
      router.refresh();
    });
  };

  useEffect(() => {
    if (scrollTo) document.getElementById(`person-${scrollTo}`)?.scrollIntoView({ block: 'start' });
  }, [scrollTo]);

  return (
    <MessagingPanel
      title={adding ? 'Add someone' : `Edit ${card.name}`}
      avatar={<PersonMark initials={personInitials(name)} colour={colour} size="sm" />}
      back={{ href: back, label: adding ? 'People' : card.name }}
      crumbs={[{ label: 'People', href: '/chat' }, ...(adding ? [] : [{ label: card.name, href: back }])]}
      foot={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saveError && <p className="mr-auto text-small text-danger">{saveError}</p>}
          <Link href={back} className={buttonVariants({ variant: 'ghost' })}>
            Cancel
          </Link>
          <Button type="button" onClick={save} pending={saving} disabled={saving || drafting || !persona.trim()}>
            {adding ? `Add ${name.trim() || 'them'}` : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <section className="flex flex-col gap-4">
          <Field id="person-name" label="Name">
            <Input id="person-name" value={name} maxLength={PERSON_NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <div>
            <Label htmlFor="person-colour-0">Colour</Label>
            <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
              {MENTOR_PALETTE.map((c, i) => (
                <button
                  key={c}
                  id={`person-colour-${i}`}
                  type="button"
                  role="radio"
                  aria-checked={colour === c}
                  aria-label={`Colour ${i + 1}`}
                  onClick={() => setColour(c)}
                  style={{ backgroundColor: c }}
                  className={cn(
                    'press press-area flex size-8 items-center justify-center rounded-full text-white',
                    'focus-visible:outline-2 focus-visible:outline-offset-2',
                    colour === c && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
                  )}
                >
                  {colour === c && <Check className="size-4" strokeWidth={1.75} aria-hidden />}
                </button>
              ))}
            </div>
          </div>
          <Field id="person-about" label="Shown under their name">
            <Input
              id="person-about"
              value={brief.who}
              maxLength={WHO_MAX}
              placeholder="An old friend who ran a bakery for thirty years"
              onChange={(e) => set('who', e.target.value)}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel as="h2">How they talk</SectionLabel>
          <div className="flex flex-wrap gap-x-6 gap-y-4">
            <div>
              <p className="mb-1 text-ui font-medium text-ink">Length</p>
              <Segmented
                label="How long a reply runs"
                value={brief.length}
                options={LENGTHS.map((l) => ({ value: l, label: LENGTH_LABELS[l] }))}
                onChange={(v) => set('length', v)}
              />
            </div>
            <div>
              <p className="mb-1 text-ui font-medium text-ink">Texts a reply</p>
              <Segmented
                label="How many texts a reply is"
                value={brief.bubbles}
                options={BUBBLES.map((b) => ({ value: b, label: BUBBLE_LABELS[b] }))}
                onChange={(v) => set('bubbles', v)}
              />
            </div>
          </div>
          <Field id="person-tone" label="Tone">
            <Input id="person-tone" value={brief.tone} maxLength={TONE_MAX} placeholder="Warm, dry, asks before advising" onChange={(e) => set('tone', e.target.value)} />
          </Field>
          <Field id="person-cares" label="What they care about">
            <Textarea id="person-cares" rows={3} value={brief.cares} maxLength={CARES_MAX} onChange={(e) => set('cares', e.target.value)} /* ui-ok: a field of the person's form, not a composer */ />
          </Field>
          <Field id="person-never" label="Things they never say">
            <Textarea id="person-never" rows={2} value={brief.never} maxLength={NEVER_MAX} onChange={(e) => set('never', e.target.value)} /* ui-ok: a field of the person's form, not a composer */ />
          </Field>
        </section>

        <section id="person-card" className="flex scroll-mt-4 flex-col gap-3">
          <SectionLabel as="h2">Their card</SectionLabel>
          {drafting && (
            <p role="status" className="flex items-center gap-1.5 text-ui text-ink">
              <DashMark size="icon" tone="brand" state="working" decorative />
              {persona.trim() ? 'Dash is redrafting the card…' : 'Dash is writing the card…'}
            </p>
          )}
          <Textarea /* ui-ok: the persona card is the field this form edits, not a composer */
            id="person-persona"
            aria-label="Persona card"
            rows={adding && !persona.trim() && !drafting ? 4 : 12}
            value={persona}
            placeholder={drafting ? '' : adding ? 'Dash drafts this from what you filled in; every reply reads it first.' : 'Every reply reads this card first.'}
            disabled={drafting}
            maxLength={PERSONA_MAX}
            aria-busy={drafting}
            className={cn(drafting && 'disabled:opacity-60')}
            onChange={(e) => setPersona(e.target.value)}
          />
          {adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <DashAction
                type="button"
                variant={persona.trim() ? 'secondary' : 'primary'}
                paid="app/chat/actions.ts#draftPersonCard"
                what="Cost of the draft"
                pending={drafting}
                disabled={drafting}
                onClick={() => void draft(false)}
              >
                {drafting ? 'Drafting the card…' : persona.trim() ? 'Draft it again' : 'Draft the card'}
              </DashAction>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <Input
                aria-label="What to change in the card"
                className="w-full max-sm:min-h-11 sm:flex-1"
                value={ask}
                maxLength={ASK_MAX}
                placeholder="Ask Dash to change it"
                disabled={drafting}
                onChange={(e) => setAsk(e.target.value)}
              />
              <DashAction
                type="button"
                variant="secondary"
                paid="app/chat/actions.ts#draftPersonCard"
                what="Cost of the redraft"
                pending={drafting}
                disabled={drafting || !ask.trim()}
                onClick={() => void draft(true)}
              >
                {drafting ? 'Redrafting…' : 'Redraft'}
              </DashAction>
            </div>
          )}
          {draftError && (
            <p role="alert" className="text-small text-danger">
              {draftError} {adding ? 'Press Draft the card to try again.' : 'Press Redraft to try again.'}
            </p>
          )}
          {!adding && card.versions.length > 0 && (
            <EarlierCards versions={card.versions} timezone={timezone} now={now} onUse={(v) => setPersona(v.persona)} current={persona} />
          )}
        </section>

        {!adding && (
          <Memory key={card.id} lines={card.memory} name={card.name} actions={actions} removing={removing} editing={editing} />
        )}

        <section>
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-ui text-ink">Join board meetings</span>
              <span className="mt-0.5 block text-small text-ink-muted">
                {card.madeByYou ? 'Off, they are in Chat only.' : 'Off, the board meets without them.'} On, the chair can seat them.
              </span>
            </span>
            <Switch checked={joins} onChange={(e) => setJoins(e.target.checked)} aria-label="Join board meetings" />
          </label>
        </section>
      </div>
    </MessagingPanel>
  );
}

function EarlierCards({
  versions,
  current,
  timezone,
  now,
  onUse,
}: {
  versions: readonly PersonaVersion[];
  current: string;
  timezone: string;
  now: number;
  onUse: (version: PersonaVersion) => void;
}) {
  return (
    <div id="person-versions" className="mt-2 scroll-mt-4">
      <p className="text-ui font-medium text-ink">Earlier cards</p>
      <ul className="mt-1 divide-y divide-border">
        {versions.map((v) => {
          const inBox = v.persona === current.trim();
          return (
            <li key={v.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-small text-ink-muted">
                  {whenDate(v.createdAt, { timeZone: timezone, now, year: 'auto' })} · {v.madeBy === 'dash' ? (v.ask ? `Dash, asked "${v.ask}"` : 'Dash') : 'You'}
                </p>
                {inBox ? (
                  <span className="shrink-0 text-small text-ink-muted">In the box</span>
                ) : (
                  <Button type="button" variant="link" onClick={() => onUse(v)} className="shrink-0">
                    Use this card
                  </Button>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-ui text-ink">{v.persona}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const MEMORY_KIND_LABELS: Record<CouncilMemory['kind'], string> = {
  fact: 'Fact',
  preference: 'Preference',
  commitment: 'Commitment',
  open_thread: 'Open thread',
};

function Memory({
  lines: initial,
  name,
  actions,
  removing,
  editing: initialEditing,
}: {
  lines: readonly CouncilMemory[];
  name: string;
  actions: PersonFormActions;
  removing: string | null;
  editing: string | null;
}) {
  const [lines, setLines] = useState(initial);
  const [editing, setEditing] = useState<string | null>(initialEditing);
  const [confirming, setConfirming] = useState<string | null>(removing);
  const [text, setText] = useState(() => initial.find((l) => l.id === initialEditing)?.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const saveLine = (id: string) =>
    start(async () => {
      const result = await actions.correct(id, text);
      if (result.error) {
        setError(result.error);
        return;
      }
      setLines((list) => list.map((l) => (l.id === id ? { ...l, text: text.replace(/\s+/g, ' ').trim() } : l)));
      setEditing(null);
      setError(null);
    });

  const removeLine = (id: string) =>
    start(async () => {
      const result = await actions.remove(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setLines((list) => list.filter((l) => l.id !== id));
      setConfirming(null);
      setError(null);
    });

  return (
    <section id="person-memory" className="scroll-mt-4">
      <SectionLabel as="h2">What {name} remembers</SectionLabel>
      {lines.length === 0 ? (
        <p className="mt-2 text-ui text-ink-muted">Nothing yet. As you talk, they keep what matters here.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {lines.map((line) => (
            <li key={line.id} className="py-2.5">
              {editing === line.id ? (
                <div className="flex flex-col gap-2">
                  <Textarea aria-label="Correct this line" rows={2} value={text} maxLength={MEMORY_LINE_MAX} onChange={(e) => setText(e.target.value)} />
                  <FieldError>{error}</FieldError>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" pending={pending} disabled={pending || !text.trim()} onClick={() => saveLine(line.id)}>
                      Save line
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-end gap-x-3 gap-y-1">
                  <p className="min-w-[min(100%,16rem)] flex-1 text-ui text-ink">
                    <span className="text-small text-ink-muted">{MEMORY_KIND_LABELS[line.kind]} · </span>
                    {line.text}
                  </p>
                  {confirming !== line.id && (
                    <div className="flex shrink-0 items-start gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(line.id);
                          setText(line.text);
                          setError(null);
                        }}
                      >
                        Correct
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(line.id)}>
                        Remove
                      </Button>
                    </div>
                  )}
                  {confirming === line.id && (
                    <div className="flex w-full flex-col gap-2">
                      <p className="text-small text-ink-muted">{name} forgets this, and no reply reads it again.</p>
                      <FieldError>{error}</FieldError>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                        <Button type="button" variant="danger" size="sm" pending={pending} disabled={pending} onClick={() => removeLine(line.id)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
