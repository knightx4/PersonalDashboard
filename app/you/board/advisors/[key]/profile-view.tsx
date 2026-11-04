'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { DetailCard, DetailPart, TabbedDetail } from '@/components/patterns/tabbed-detail';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import type { Subject } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError, Switch } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { LiveDot } from '@/components/ui/live-dot';
import { SectionLabel } from '@/components/ui/section-heading';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { brainState, type RosterAdvisor } from '@/lib/you/board-advisors';
import type { Brain } from '@/lib/you/board-brain';
import {
  ADVISOR_TABS,
  percent,
  recordLine,
  type AdvisorDecision,
  type AdvisorTab,
} from '@/lib/you/board-profile';
import { OUTCOME_LABELS } from '@/lib/you/board-reviews';
import type { TrackRecord } from '@/lib/you/board-scoring';
import { AdvisorAvatar } from '../../advisor-avatar';
import { AvatarEditor, type DrawAvatar, type Drawn, type SaveAvatar } from '../../avatar-editor';
import { useRefreshWhileRunning } from '../../refresh-while-running';
import { topicRecordText } from '../../track-records';

/**
 * One advisor's profile (plan #2581.5), on the tabbed detail pattern: their
 * avatar large and their name, a guest marked as an AI impression, and the
 * assessment they own, then About (the assessment in full, how they talk,
 * the questions they ask, their rules and frameworks, from the brain), Talk
 * (a one-on-one chat with them, plan #2581.6, talk-view.tsx), Track
 * record (forecasts scored by topic, and every decision they weighed in on
 * with what they forecast and what happened) and Sources. Pressing the avatar
 * opens the editor for how they look (plan #2581.3).
 *
 * A guest whose brain is being built says so and refreshes until it is done;
 * one that failed says why and offers Try again.
 */

export type ProfileActions = {
  retry: (id: string) => Promise<{ error: string | null }>;
  setActive: (id: string, active: boolean) => Promise<{ error: string | null }>;
  drawAvatar: DrawAvatar;
  saveAvatar: SaveAvatar;
};

export function ProfileView({
  advisor,
  brain,
  record,
  decisions,
  tab,
  now,
  subject,
  actions,
  talk = null,
  editing = null,
}: {
  advisor: RosterAdvisor;
  brain: Brain | null;
  record: TrackRecord | null;
  decisions: readonly AdvisorDecision[];
  /** The open tab, from the address. */
  tab: AdvisorTab;
  /** When the page was read, for whether a build is still going. */
  now: number;
  subject: Subject;
  actions: ProfileActions;
  /** The Talk tab's content, drawn on the server (talk-section.tsx); shown when `tab` is talk. */
  talk?: React.ReactNode;
  /** Their look open to change, with its drawing, as the gallery draws it. */
  editing?: Drawn | null;
}) {
  const state = brainState(advisor, now);
  const guest = advisor.kind === 'guest';
  useRefreshWhileRunning(state.kind === 'building');

  const [look, setLook] = useState<Drawn | null>(editing);
  /** The look being tried on, drawn in the header's avatar while the editor is open. */
  const [trying, setTrying] = useState<string | null>(editing?.svg ?? null);
  const [opening, setOpening] = useState(false);
  const [active, setActive] = useState(advisor.active);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const openEditor = () => {
    if (look) {
      setLook(null);
      setTrying(null);
      return;
    }
    setOpening(true);
    setError(null);
    startTransition(async () => {
      const result = await actions.drawAvatar(advisor.avatar);
      setOpening(false);
      if (result.error || !result.svg || !result.look) {
        setError(result.error ?? 'Their look could not be drawn. Try again.');
        return;
      }
      setLook({ svg: result.svg, look: result.look });
      setTrying(result.svg);
    });
  };
  const closeEditor = () => {
    setLook(null);
    setTrying(null);
  };
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

  const changeLabel = `Change how ${advisor.name} looks`;
  const assessment = brain?.assessment?.name ?? advisor.assessment;
  const tabs = ADVISOR_TABS.map((t) => ({
    ...t,
    count: t.id === 'record' ? (record?.scored ?? 0) : t.id === 'sources' ? (brain?.sources.length ?? 0) : undefined,
  }));

  return (
    <TabbedDetail
      subject={subject}
      portrait={
        <Tooltip label={changeLabel} align="start">
          <button
            type="button"
            aria-label={changeLabel}
            aria-expanded={look !== null}
            aria-busy={opening || undefined}
            onClick={openEditor}
            className="press-area rounded-pill transition-opacity duration-quick hover:opacity-80"
          >
            <AdvisorAvatar
              advisorKey={advisor.key}
              name={advisor.name}
              size="lg"
              decorative
              svg={trying ?? undefined}
            />
          </button>
        </Tooltip>
      }
      under={
        look && (
          <AvatarEditor
            advisor={advisor}
            start={look}
            draw={actions.drawAvatar}
            save={actions.saveAvatar}
            onDone={closeEditor}
            onDrawn={(drawn) => setTrying(drawn.svg)}
          />
        )
      }
      title={advisor.name}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {guest && <Chip size="sm">AI impression</Chip>}
          <span>{assessment ?? advisor.question}</span>
        </span>
      }
      glance={
        <>
          <Property label="Seat" value={guest ? 'Guest' : 'Seat'} />
          {record && <Property label="Track record" value={`${record.scored} scored`} />}
        </>
      }
      detailCount={(record ? 1 : 0) + (brain ? 1 : 0) + (guest ? 1 : 0)}
      properties={
        <PropertyList>
          {record && <Property label="Mean score" value={record.brier.toFixed(2)} hint="0 is a perfect forecast, 0.25 a coin toss" />}
          {brain && <Property label="Sources" value={String(brain.sources.length)} />}
          {guest && (
            <Property
              label="In meetings"
              value={
                <Tooltip label={active ? 'The chair may bring them in' : 'Kept off the advisors'} align="start">
                  <span className="inline-flex items-center gap-2">
                    <Switch
                      aria-label={`${advisor.name}: the chair may bring them in`}
                      checked={active}
                      onChange={(event) => toggle(event.target.checked)}
                    />
                    <span>{active ? 'On' : 'Off'}</span>
                  </span>
                </Tooltip>
              }
            />
          )}
        </PropertyList>
      }
      tabs={tabs}
      label="Advisor"
    >
      <div className="space-y-4">
        {error && <FieldError>{error}</FieldError>}
        {state.kind === 'building' && <Building />}
        {state.kind === 'failed' && <Failed advisorId={advisor.id} why={state.why} retry={actions.retry} />}
        {tab === 'talk' ? (
          talk
        ) : tab === 'record' ? (
          <RecordTab record={record} decisions={decisions} />
        ) : tab === 'sources' ? (
          <SourcesTab brain={brain} />
        ) : (
          <AboutTab advisor={advisor} brain={brain} />
        )}
      </div>
    </TabbedDetail>
  );
}

function Building() {
  return (
    <Card padding="standard" className="flex items-start gap-2 text-ui text-ink">
      <LiveDot tone="muted" className="mt-2 size-1.5 shrink-0" />
      <p>Dash is reading their public work to build how they think. This takes a while, and the page fills in once it is done.</p>
    </Card>
  );
}

function Failed({
  advisorId,
  why,
  retry,
}: {
  advisorId: string;
  why: string;
  retry: ProfileActions['retry'];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const press = () => {
    setPending(true);
    setError(null);
    startTransition(async () => {
      const result = await retry(advisorId);
      setPending(false);
      if (result.error) setError(result.error);
    });
  };
  return (
    <Card padding="standard" className="space-y-3">
      <p className="flex items-start gap-2 text-ui text-ink [overflow-wrap:anywhere]">
        <AlertTriangle aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-danger" />
        <span>
          <span className="font-medium">Their brain did not build.</span> {why}
        </span>
      </p>
      <DashAction
        type="button"
        variant="secondary"
        size="sm"
        pending={pending}
        routine="board"
        what="Cost of building an advisor"
        align="start"
        onClick={press}
      >
        <RotateCcw aria-hidden strokeWidth={1.75} className="size-3.5" />
        {pending ? 'Retrying…' : 'Try again'}
      </DashAction>
      <FieldError>{error}</FieldError>
    </Card>
  );
}

/** How they think, from the brain: the assessment, their voice, their questions, rules and frameworks. */
function AboutTab({ advisor, brain }: { advisor: RosterAdvisor; brain: Brain | null }) {
  if (!brain) {
    // The question they own is already under their name.
    return advisor.focus ? (
      <DetailCard>
        <DetailPart label="What they look at">
          <p className="text-body text-ink [overflow-wrap:anywhere]">{advisor.focus}</p>
        </DetailPart>
      </DetailCard>
    ) : null;
  }
  return (
    <DetailCard>
      {brain.assessment ? (
        <DetailPart label="The assessment they own">
          <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">{brain.assessment.name}</p>
          <p className="text-body text-ink [overflow-wrap:anywhere]">{brain.assessment.text}</p>
        </DetailPart>
      ) : (
        <DetailPart label="The question they own">
          <p className="text-body text-ink [overflow-wrap:anywhere]">{advisor.question}</p>
        </DetailPart>
      )}
      {brain.voice && (
        <DetailPart label="How they talk">
          <p className="text-body text-ink [overflow-wrap:anywhere]">{brain.voice}</p>
        </DetailPart>
      )}
      {brain.questions.length > 0 && (
        <DetailPart label="What they ask">
          <ul className="list-disc space-y-1 pl-5 text-body text-ink">
            {brain.questions.map((q) => (
              <li key={q} className="[overflow-wrap:anywhere]">
                {q}
              </li>
            ))}
          </ul>
        </DetailPart>
      )}
      {brain.rules.length > 0 && (
        <DetailPart label="Their rules">
          <ol className="list-decimal space-y-1 pl-5 text-body text-ink">
            {brain.rules.map((rule) => (
              <li key={rule} className="[overflow-wrap:anywhere]">
                {rule}
              </li>
            ))}
          </ol>
        </DetailPart>
      )}
      {brain.frameworks.length > 0 && (
        <DetailPart label="How they work a problem">
          <dl className="space-y-2">
            {brain.frameworks.map((f) => (
              <div key={f.name}>
                <dt className="text-body font-medium text-ink [overflow-wrap:anywhere]">{f.name}</dt>
                <dd className="text-body text-ink-muted [overflow-wrap:anywhere]">{f.text}</dd>
              </div>
            ))}
          </dl>
        </DetailPart>
      )}
    </DetailCard>
  );
}

/** Their forecast option by option, named, the one you chose marked. */
function Forecast({ decision }: { decision: AdvisorDecision }) {
  const name = (letter: string) => decision.options.find((o) => o.letter === letter)?.text ?? `Option ${letter}`;
  if (!decision.forecast) {
    return (
      <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
        {decision.pick
          ? `Backed ${name(decision.pick)}, before forecasts had probabilities`
          : 'No single pick, before forecasts had probabilities'}
      </p>
    );
  }
  const letters = Object.keys(decision.forecast).sort();
  return (
    <ul className="space-y-0.5 text-small text-ink-muted">
      {letters.map((letter) => {
        const chosen = letter === decision.chosen;
        return (
          <li key={letter} className="flex items-baseline gap-2">
            <span className={cn('tabular w-9 shrink-0 text-right', chosen && 'font-medium text-ink')}>
              {percent(decision.forecast![letter])}
            </span>
            <span className={cn('min-w-0 [overflow-wrap:anywhere]', chosen && 'text-ink')}>
              {name(letter)}
              {chosen && ' (you chose this)'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function happened(decision: AdvisorDecision): string {
  if (!decision.chosen) return 'Not decided yet';
  if (!decision.outcome) return 'How it went is not in yet';
  const scored = decision.brier !== null ? `, their forecast scored ${decision.brier.toFixed(2)}` : '';
  return `${OUTCOME_LABELS[decision.outcome]}${scored}`;
}

/** The scores by topic, then every decision they weighed in on. */
function RecordTab({ record, decisions }: { record: TrackRecord | null; decisions: readonly AdvisorDecision[] }) {
  if (!record && decisions.length === 0) {
    return (
      <Card padding="standard">
        <p className="text-ui text-ink">No track record yet.</p>
        <p className="mt-1 text-ui text-ink-muted">
          It starts with their first scored forecast: bring them a decision from the Advisors tab, and once you say
          how it went, their probability for what you chose is scored.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionLabel as="h2">How often they were right</SectionLabel>
        <Card padding="standard" className="space-y-2">
          {record ? (
            <>
              <p className="text-body text-ink">
                <span className="tabular font-medium">{recordLine(record)}</span>
              </p>
              <ul className="space-y-1 text-ui text-ink">
                {record.topics.map((t) => (
                  <li key={t.topic} className="tabular">
                    {topicRecordText(t)}
                  </li>
                ))}
              </ul>
              <p className="text-small text-ink-muted">
                0 is a perfect forecast and 0.25 a coin toss. After five scored on a topic, the chair weighs them by
                it.
              </p>
            </>
          ) : (
            <p className="text-ui text-ink-muted">
              None scored yet. It starts once you say how one of the decisions below went.
            </p>
          )}
        </Card>
      </section>
      <section className="space-y-2">
        <SectionLabel as="h2" count={decisions.length}>
          Decisions they weighed in on
        </SectionLabel>
        {decisions.length === 0 ? (
          <Card padding="standard">
            <p className="text-ui text-ink-muted">None yet. Bring them a decision from the Advisors tab.</p>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {decisions.map((d) => (
                <li key={d.questionId} className="card-pad-x row-pad space-y-0.5">
                  {d.meetingId ? (
                    <Link href={`/you/board/${d.meetingId}`} className="text-ui text-ink hover:text-accent">
                      <span className="[overflow-wrap:anywhere]">{d.question}</span>
                    </Link>
                  ) : (
                    <p className="text-ui text-ink [overflow-wrap:anywhere]">{d.question}</p>
                  )}
                  <Forecast decision={d} />
                  <p className="text-small text-ink-muted">{happened(d)}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}

/** What their brain was built from. A note of the person's opens in the vault; the rest open on their site. */
function SourcesTab({ brain }: { brain: Brain | null }) {
  if (!brain || brain.sources.length === 0) {
    return (
      <Card padding="standard">
        <p className="text-ui text-ink-muted">No sources yet. They are listed once Dash has built how they think.</p>
      </Card>
    );
  }
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {brain.sources.map((source) => {
          const external = /^https?:\/\//i.test(source.link);
          return (
            <li key={source.link} className="card-pad-x row-pad">
              {external ? (
                <a
                  href={source.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${linkVariants()} text-ui [overflow-wrap:anywhere]`}
                >
                  {source.label}
                </a>
              ) : (
                <Link href={source.link} className={`${linkVariants()} text-ui [overflow-wrap:anywhere]`}>
                  {source.label}
                </Link>
              )}
              {external && (
                <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                  {hostOf(source.link)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
