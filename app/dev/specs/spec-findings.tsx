import Link from 'next/link';
import { Disclosure } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { LinkedText } from '@/components/ui/linked-text';
import { cn } from '@/lib/cn';
import {
  FINDING_KIND_LABEL,
  findingChangeHref,
  groupFindings,
  type SpecFinding,
} from '@/lib/specs/findings';

/**
 * What the latest spec audit found, grouped by kind (plan #1525). On a spec's
 * page in Dev, and under a workspace that has no spec on /dev/specs.
 */

/** "Monday 5 October". UTC, as the weekly schedule is. */
function day(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

const DECIDED: Record<string, string> = { applied: 'Written into the spec', declined: 'Declined' };

/** What the finding led to: a link to its change, or what it asks for when none was drafted. */
function Outcome({ finding }: { finding: SpecFinding }) {
  const { change } = finding;
  if (change) {
    const href = findingChangeHref(change);
    return (
      <p className="text-ui text-ink-muted">
        {href ? (
          <>
            Proposed change:{' '}
            <Link href={href} className="text-ink underline-offset-2 hover:underline">
              {change.title}
            </Link>
          </>
        ) : (
          <>
            {DECIDED[change.status] ?? 'Decided'}: {change.title}
          </>
        )}
      </p>
    );
  }
  if (finding.proposal === 'change_code') {
    return <p className="text-ui text-ink-muted">Calls for a change to the code.</p>;
  }
  if (finding.proposal === 'change_spec') {
    return (
      <p className="text-ui text-ink-muted">
        Calls for a change to the spec. None is drafted yet, since at most five wait on you at once.
      </p>
    );
  }
  return null;
}

function FindingRow({ finding }: { finding: SpecFinding }) {
  return (
    <li className="min-w-0 space-y-1 py-2.5 first:pt-0 last:pb-0">
      {finding.section && (
        <p className="text-small text-ink-muted">
          {finding.section === 'Rules' ? 'Rules' : <>In “{finding.section}”</>}
        </p>
      )}
      <p className="whitespace-pre-wrap text-body text-ink [overflow-wrap:anywhere]">
        <LinkedText text={finding.finding} />
      </p>
      {finding.evidence && (
        <p className="text-small text-ink-ghost [overflow-wrap:anywhere]">{finding.evidence}</p>
      )}
      <Outcome finding={finding} />
    </li>
  );
}

export function SpecFindings({
  auditAt,
  findings,
  heading = 'What the last audit found',
  headingId = 'spec-findings-heading',
}: {
  auditAt: string | null;
  findings: SpecFinding[];
  heading?: string;
  /** Unique on the page, for a page that draws more than one. */
  headingId?: string;
}) {
  const groups = groupFindings(findings);

  return (
    <section className={cn(cardVariants(), 'px-4 py-4')} aria-labelledby={headingId}>
      <h2 id={headingId} className="text-body font-semibold text-ink">
        {heading}
      </h2>
      <p className="mt-1 text-ui text-ink-muted">
        {auditAt === null
          ? 'No audit has run yet. Each Monday Dash compares the code with every spec and records what it finds here.'
          : groups.length === 0
            ? `The audit on ${day(auditAt)} recorded nothing for this spec.`
            : `From the audit Dash ran on ${day(auditAt)}.`}
      </p>

      {groups.map((group) =>
        group.kind === 'holds' ? (
          // Folded: what holds is reassurance, and the kinds above it are the
          // ones that ask for something.
          <Disclosure
            key={group.kind}
            title={FINDING_KIND_LABEL[group.kind]}
            meta={<span className="tabular">{group.findings.length}</span>}
            className="mt-4"
          >
            <ul className="divide-y divide-border pt-2">
              {group.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          </Disclosure>
        ) : (
          <div key={group.kind} className="mt-4">
            <h3 className="text-ui font-semibold text-ink">
              {FINDING_KIND_LABEL[group.kind]}
              <span className="tabular ml-2 font-normal text-ink-muted">{group.findings.length}</span>
            </h3>
            <ul className="mt-2 divide-y divide-border">
              {group.findings.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          </div>
        ),
      )}
    </section>
  );
}
