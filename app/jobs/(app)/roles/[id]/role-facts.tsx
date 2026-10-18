import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { Property } from '@/components/shell/detail-layout';
import { DetailFacts } from '@/components/patterns/list-detail';
import { SectionLabel } from '@/components/ui/section-heading';
import type { FactField, FactOriginRecord, RoleFactOrigins } from '@/lib/jobs/fact-origins';

/**
 * The role page's facts, each of the role's own with where it came from
 * (plan #2343.3). A firsthand fact (the posting, or you) carries its source
 * in muted ink; a secondhand one, from a recruiter's email, in the caution
 * tone with the message linked; a guess is "Dash guess" with a dotted
 * underline, and its value is muted too, so it never reads as confirmed. A
 * fact saved before origins were kept, and an empty one, carry no label.
 */
export type RoleFactsProps = {
  roleId: string;
  applied: string;
  confirmed: string;
  firstHumanReply: string;
  channel: React.ReactNode;
  compBand: string | null;
  location: string | null;
  workMode: string | null;
  seniority: string | null;
  postingStatus: string | null;
  companyStage: string | null;
  ats: string;
  outcome: string;
  origins: RoleFactOrigins;
};

const SOURCE_LABEL: Record<Exclude<FactOriginRecord['origin'], 'unknown'>, string> = {
  posting: 'Posting',
  recruiter_email: 'Recruiter email',
  dash: 'Dash',
  you: 'You',
};

/** The words the label says, or null for a fact with no known origin. */
export function originLabel(record: FactOriginRecord | null): string | null {
  if (!record || record.origin === 'unknown') return null;
  if (record.origin === 'dash' && record.certainty === 'guess') return 'Dash guess';
  return SOURCE_LABEL[record.origin];
}

/** The mail tab opened on the message a fact came from. */
export function originMessageHref(roleId: string, messageId: string): string {
  return `/jobs/roles/${roleId}?tab=mail&message=${encodeURIComponent(messageId)}`;
}

function OriginLabel({ roleId, record }: { roleId: string; record: FactOriginRecord | null }) {
  const label = originLabel(record);
  if (!record || !label) return null;
  if (record.certainty === 'guess') {
    return (
      <span
        /* ui-ok: not a link; the dotted underline is how a guess is marked (plan #2343.3) */
        className="text-ink-muted underline decoration-dotted decoration-ink-muted underline-offset-2"
        title="A guess: nobody has confirmed it"
      >
        {label}
      </span>
    );
  }
  if (record.certainty === 'secondhand') {
    return record.messageId ? (
      <Link
        href={originMessageHref(roleId, record.messageId)}
        className={cn(linkVariants({ tone: 'quiet' }), 'text-caution hover:text-caution')}
        title="Secondhand: open the message it came from"
      >
        {label}
      </Link>
    ) : (
      <span className="text-caution" title="Secondhand">
        {label}
      </span>
    );
  }
  return <span className="text-ink-muted">{label}</span>;
}

/**
 * The location, work mode and seniority after the company in the page's
 * header, each led by " · ". A guess is drawn as the facts card draws it,
 * dotted, so the header never reads a guess as settled.
 */
export function HeaderFacts({
  facts,
  origins,
}: {
  facts: Array<[FactField, string | null]>;
  origins: RoleFactOrigins;
}) {
  return (
    <>
      {facts
        .filter(([, value]) => value)
        .map(([field, value]) => (
          <span key={field}>
            {' · '}
            {origins[field]?.certainty === 'guess' ? (
              <span
                /* ui-ok: not a link; the dotted underline is how a guess is marked (plan #2343.3) */
                className="underline decoration-dotted decoration-ink-muted underline-offset-2"
                title="Dash guess: nobody has confirmed it"
              >
                {value}
              </span>
            ) : (
              value
            )}
          </span>
        ))}
    </>
  );
}

export function RoleFacts(props: RoleFactsProps) {
  const { roleId, origins } = props;

  /** A role fact: its value, or the dash; its origin only when it has a value. */
  const fact = (label: string, field: FactField, value: string | null) => {
    const record = value && originLabel(origins[field]) ? origins[field] : null;
    if (!record) return <Property label={label} value={value || '—'} />;
    // Property's own markup, with a second line for the origin under the value.
    return (
      <div className="min-w-0">
        <SectionLabel as="dt">{label}</SectionLabel>
        <dd className={cn('tabular mt-0.5 truncate text-ui', record.certainty === 'guess' ? 'text-ink-muted' : 'text-ink')}>
          {value}
        </dd>
        <dd className="mt-0.5 truncate text-small">
          <OriginLabel roleId={roleId} record={record} />
        </dd>
      </div>
    );
  };

  return (
    <DetailFacts>
      <Property label="Applied" value={props.applied} />
      <Property label="Confirmed" value={props.confirmed} />
      <Property
        label="First human reply"
        value={props.firstHumanReply}
        hint="Automated confirmations never set this."
      />
      <Property label="Channel" value={props.channel} />
      {fact('Comp band', 'comp', props.compBand)}
      {fact('Location', 'location', props.location)}
      {fact('Work mode', 'work_mode', props.workMode)}
      {fact('Seniority', 'seniority', props.seniority)}
      {fact('Posting', 'posting_status', props.postingStatus)}
      {fact('Company stage', 'stage', props.companyStage)}
      <Property label="ATS" value={props.ats} />
      <Property label="Outcome" value={props.outcome} />
    </DetailFacts>
  );
}
