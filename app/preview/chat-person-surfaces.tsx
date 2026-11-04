import { AppShell } from '@/components/shell/app-shell';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { MODELS } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { tabsFor } from '@/lib/shell/tabs';
import { MENTOR_PALETTE } from '@/lib/you/chat-threads-model';
import { newPersonCard, type PersonCard } from '@/lib/you/people-cards-model';
import { PeopleView } from '@/app/chat/people-view';
import { PersonForm } from '@/app/chat/people/person-form';
import { BUILDER_TEXTS, textSwitches } from '@/lib/you/first-texts';
import { BUILDER_ROW, CHAT_PEOPLE } from './chat-surfaces';

/**
 * Adding and editing a person in Chat (plan #2748.11), in the gallery: the
 * form for someone new, empty, while Dash drafts their card, and when the
 * draft failed; and the form for a mentor already there, with their card,
 * the earlier cards, what they remember and the confirm before a line goes.
 */

const NOW = Date.parse('2026-11-03T09:00:00Z');
const ZONE = 'Europe/London';

const FRANKLIN_CARD = `Who you are
You are Benjamin Franklin: printer, writer, inventor and diplomat, who rose from a runaway apprentice by keeping accounts of his days as carefully as of his money.

How you talk
Short texts, a sentence or two each, two or three to a reply. Plain words, a dry joke when it helps, and a maxim only when it earns its place. Ask before you advise.

What you care about
Habits that compound, money kept honestly, and doing the useful thing today rather than the grand thing someday.

What you never do
Lecture, moralise about pleasure, or pretend to know what the person has not told you.`;

export const FRANKLIN_PERSON: PersonCard = {
  id: '00000000-0000-4000-8000-000000000002',
  key: 'benjamin-franklin',
  name: 'Benjamin Franklin',
  colour: MENTOR_PALETTE[1],
  kind: 'guest',
  madeByYou: false,
  brief: {
    who: 'Money and habits',
    length: 'short',
    bubbles: 'few',
    tone: 'Dry, warm, practical',
    cares: 'Habits that compound, money kept honestly, doing the useful thing today.',
    never: 'Lectures about pleasure, or claims to know what I have not said.',
  },
  persona: FRANKLIN_CARD,
  joinsMeetings: true,
  texts: null,
  versions: [
    {
      id: 'v2',
      persona: FRANKLIN_CARD.replace('Short texts, a sentence or two each', 'Texts of a paragraph or so'),
      madeBy: 'dash',
      ask: 'shorter, and ask before advising',
      createdAt: '2026-10-29T18:20:00Z',
    },
    {
      id: 'v1',
      persona:
        'You are Benjamin Franklin. You speak in the measured voice of the eighteenth century and offer the person maxims from Poor Richard when they ask about money, work or habits.',
      madeBy: 'dash',
      ask: null,
      createdAt: '2026-10-12T09:00:00Z',
    },
  ],
  memory: [
    { id: 'mem1', kind: 'commitment', text: 'Finish the Northwind application by Friday 7 November.', dueOn: '2026-11-07', doneAt: null, createdAt: '2026-11-03T07:12:00Z' },
    { id: 'mem2', kind: 'fact', text: 'Took a year out in 2025 to care for their father, which the cover letter has to explain.', dueOn: null, doneAt: null, createdAt: '2026-11-03T09:00:00Z' },
    { id: 'mem3', kind: 'preference', text: 'Would rather be asked a question than told what to do.', dueOn: null, doneAt: null, createdAt: '2026-10-28T19:10:00Z' },
    { id: 'mem4', kind: 'open_thread', text: 'Whether to take the Northwind call at all.', dueOn: null, doneAt: null, createdAt: '2026-10-28T19:02:00Z' },
  ],
};

/** Someone new, filled in up to the card: what a draft reads. */
const NEW_FILLED: PersonCard = {
  ...newPersonCard(CHAT_PEOPLE.map((p) => p.colour)),
  name: 'Aunt Margaret',
  brief: {
    who: 'My aunt, who ran a bakery in Leeds for thirty years',
    length: 'short',
    bubbles: 'few',
    tone: 'Blunt, funny, never unkind',
    cares: 'Whether I am eating, sleeping and seeing people. Money only when I bring it up.',
    never: 'Business jargon, or telling me to hustle.',
  },
};

/** About what one draft costs, as the hint beside Draft and Redraft says it. */
const DRAFT_COST: CostEstimate = {
  lowMicros: 12_000,
  medianMicros: 16_000,
  highMicros: 24_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [MODELS.personaDraft],
};

function Shell({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <PaidCostsProvider costs={{ 'app/chat/actions.ts#draftPersonCard': DRAFT_COST }}>
    <AppShell
      account="preview"
      module="chat"
      sections={tabsFor('chat', true)}
      displayName="Chris"
      email="chris@example.com"
      isOwner
      counts={{ jobs: '3', todo: '8', shopping: '1' }}
      theme={{ kind: 'written', id: 'paper' }}
      brief={null}
      pathname={path}
    >
      {children}
    </AppShell>
    </PaidCostsProvider>
  );
}

/** The form for someone new: empty, filled in while Dash drafts, or after a draft failed. */
export function ChatPersonAddSurface({ state = 'empty' }: { state?: 'empty' | 'drafting' | 'failed' }) {
  const card = state === 'empty' ? newPersonCard(CHAT_PEOPLE.map((p) => p.colour)) : NEW_FILLED;
  return (
    <Shell path="/chat">
      <PeopleView rows={CHAT_PEOPLE} timezone={ZONE} now={NOW} live={false} adding>
        <PersonForm
          card={card}
          timezone={ZONE}
          now={NOW}
          drafting={state === 'drafting'}
          draftError={state === 'failed' ? 'Dash is busy and could not draft the card.' : null}
          scrollTo={state === 'empty' ? null : 'card'}
        />
      </PeopleView>
    </Shell>
  );
}

/** The form for a mentor already there: the top, the card with earlier cards, redrafting, or the memory with a remove confirming. */
export function ChatPersonEditSurface({ state = 'form' }: { state?: 'form' | 'card' | 'redrafting' | 'memory' }) {
  return (
    <Shell path={`/chat/people/${FRANKLIN_PERSON.key}`}>
      <PeopleView rows={CHAT_PEOPLE} current={FRANKLIN_PERSON.key} timezone={ZONE} now={NOW} live={false}>
        <PersonForm
          card={FRANKLIN_PERSON}
          timezone={ZONE}
          now={NOW}
          drafting={state === 'redrafting'}
          removing={state === 'memory' ? 'mem2' : null}
          editing={state === 'memory' ? 'mem1' : null}
          scrollTo={state === 'card' ? 'versions' : state === 'redrafting' ? 'card' : state === 'memory' ? 'memory' : null}
        />
      </PeopleView>
    </Shell>
  );
}

/** The builder's form (plan #2854.1): what it texts first about, with failed or stalled builds switched off. */
const BUILDER_PERSON: PersonCard = {
  id: '00000000-0000-4000-8000-000000000007',
  key: BUILDER_ROW.key,
  name: BUILDER_ROW.name,
  colour: BUILDER_ROW.colour,
  kind: 'guest',
  madeByYou: true,
  brief: {
    who: 'Dev',
    length: 'short',
    bubbles: 'few',
    tone: 'Brief and plain',
    cares: 'What shipped, what is building and what needs me.',
    never: 'Detail I did not ask for.',
  },
  persona: 'You are the builder. You keep the person up to date on Dev in a few plain lines, and give detail only when asked.',
  joinsMeetings: false,
  versions: [],
  memory: [],
  texts: textSwitches(BUILDER_TEXTS, ['needs_you', 'question', 'shipped']),
};

/** The builder's form scrolled to the switches for when it texts first. */
export function ChatPersonTextsSurface() {
  return (
    <Shell path={`/chat/people/${BUILDER_ROW.key}`}>
      <PeopleView rows={[BUILDER_ROW, ...CHAT_PEOPLE]} current={BUILDER_ROW.key} timezone={ZONE} now={NOW} live={false}>
        <PersonForm card={BUILDER_PERSON} timezone={ZONE} now={NOW} scrollTo="texts" />
      </PeopleView>
    </Shell>
  );
}
