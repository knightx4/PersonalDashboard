import { Award } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { linkVariants } from '@/components/ui/link';
import { SectionHeading } from '@/components/ui/section-heading';
import { LINKEDIN_IMPORT_HREF, profileAnchor, type ProfileEntry, type ProfileLists } from '@/lib/you/profile-entries';
import { dateLabel } from '@/lib/you/work-history';

/**
 * The schools, certifications, honors and skills from your LinkedIn profile
 * on You's Work & school tab (plan #2432.7), one section each, between your
 * jobs and your transcripts. The LinkedIn import on the Jobs settings page
 * fills them. Before it has run, one panel says what it brings and links to
 * it; after, a kind your profile has none of is not drawn. Courses from the
 * profile that are on none of your transcripts are listed under the school,
 * with no grade. Drawn the same by the page and the gallery.
 */
export function ProfileSections({ lists }: { lists: ProfileLists }) {
  const any = Object.values(lists).some((list) => list.length > 0);
  if (!any) return <NoProfile />;
  return (
    <>
      {(lists.school.length > 0 || lists.course.length > 0) && <Schools schools={lists.school} courses={lists.course} />}
      {lists.certification.length > 0 && (
        <Section id="certifications" title="Certifications" count={lists.certification.length}>
          <Rows>
            {lists.certification.map((c) => (
              <Row
                key={c.id}
                entry={c}
                heading={c.name}
                dates={certificationDates(c)}
                under={[
                  c.detail,
                  c.code ? `License ${c.code}` : null,
                  c.url ? (
                    <a key="url" href={c.url} target="_blank" rel="noopener noreferrer" className={linkVariants({ tone: 'quiet' })}>
                      Credential
                    </a>
                  ) : null,
                ]}
              />
            ))}
          </Rows>
        </Section>
      )}
      {lists.honor.length > 0 && (
        <Section id="honors" title="Honors" count={lists.honor.length}>
          <Rows>
            {lists.honor.map((h) => (
              <Row key={h.id} entry={h} heading={h.name} dates={h.started ? dateLabel(h.started) : null} under={[]} note={h.description} />
            ))}
          </Rows>
        </Section>
      )}
      {lists.skill.length > 0 && (
        <Section id="skills" title="Skills" count={lists.skill.length}>
          <SkillList skills={lists.skill} />
        </Section>
      )}
    </>
  );
}

/** Before any import: one panel for all four kinds, with the one way to fill them. */
function NoProfile() {
  return (
    <section aria-labelledby="linkedin-profile" className="mb-8">
      <SectionHeading id="linkedin-profile" title="Schools, certifications, honors and skills" className="mb-2" />
      <EmptyState
        size="box"
        align="start"
        icon={Award}
        title="Nothing from LinkedIn yet"
        description="Import your LinkedIn export and the schools, certifications, honors and skills on your profile are listed here, next to your jobs."
        action={{ label: 'Import your LinkedIn export', href: LINKEDIN_IMPORT_HREF }}
      />
    </section>
  );
}

function SkillList({ skills }: { skills: ProfileEntry[] }) {
  return (
    <Card padding="dense">
      <ul className="flex flex-wrap gap-1.5 py-1" aria-label="Skills">
        {skills.map((s) => (
          <li key={s.id} id={profileAnchor(s.id)} className="max-w-full scroll-mt-bar">
            <Chip className="max-w-full">
              <span className="min-w-0 truncate">{s.name}</span>
            </Chip>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Schools({ schools, courses }: { schools: ProfileEntry[]; courses: ProfileEntry[] }) {
  // With one school, its courses sit under it; with several, LinkedIn does not say which, so they close the list.
  const nested = schools.length === 1;
  return (
    <Section id="schools" title="Schools" count={schools.length}>
      <Rows>
        {schools.map((s) => (
          <Row
            key={s.id}
            entry={s}
            heading={s.name}
            dates={range(s.started, s.ended)}
            under={[s.detail]}
            note={[s.activities ? `Activities: ${s.activities}` : null, s.description].filter(Boolean).join(' · ') || null}
          >
            {nested && courses.length > 0 && <Courses courses={courses} />}
          </Row>
        ))}
        {!nested && courses.length > 0 && (
          <li className="py-2.5">
            <p className="text-body font-medium text-ink">Courses on your profile</p>
            <Courses courses={courses} />
          </li>
        )}
      </Rows>
    </Section>
  );
}

function Courses({ courses }: { courses: ProfileEntry[] }) {
  return (
    <div className="mt-1.5">
      <p className="text-small text-ink-muted">
        {courses.length} {courses.length === 1 ? 'course' : 'courses'}, not on a transcript
      </p>
      <ul className="mt-0.5">
        {courses.map((c) => (
          <li key={c.id} id={profileAnchor(c.id)} className="scroll-mt-bar text-small text-ink">
            {c.name}
            {c.code && <span className="tabular-nums text-ink-muted"> · {c.code}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <SectionHeading id={id} title={title} count={count > 0 ? `${count} from LinkedIn` : undefined} className="mb-2" />
      {children}
    </section>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <Card padding="dense">
      <ul className="divide-y divide-border">{children}</ul>
    </Card>
  );
}

function Row({
  entry,
  heading,
  dates,
  under,
  note,
  children,
}: {
  entry: ProfileEntry;
  heading: React.ReactNode;
  dates: string | null;
  under: React.ReactNode[];
  note?: string | null;
  children?: React.ReactNode;
}) {
  const parts = under.filter(Boolean);
  return (
    <li id={profileAnchor(entry.id)} className="scroll-mt-bar py-2.5 target:bg-accent-tint">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-body font-medium text-ink">{heading}</p>
        {dates && <p className="shrink-0 text-small tabular-nums text-ink">{dates}</p>}
      </div>
      {parts.length > 0 && (
        <p className="text-small text-ink-muted">
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {part}
            </span>
          ))}
        </p>
      )}
      {note && <p className="mt-0.5 line-clamp-2 text-small text-ink-muted">{note}</p>}
      {children}
    </li>
  );
}

/** "2012 – 2016", or the one date there is. */
function range(started: string | null, ended: string | null): string | null {
  if (started && ended) return started === ended ? dateLabel(started) : `${dateLabel(started)} – ${dateLabel(ended)}`;
  return started ? dateLabel(started) : ended ? dateLabel(ended) : null;
}

/** "Mar 2024 – Mar 2026", or "Since Apr 2021" for one that does not expire. */
function certificationDates(c: ProfileEntry): string | null {
  if (c.started && !c.ended) return `Since ${dateLabel(c.started)}`;
  return range(c.started, c.ended);
}
