'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { Network } from 'lucide-react';
import { ChipSelect } from '@/components/ui/field';
import { Card, CardSection, cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import { KindBadge } from '@/components/learn/kind-badge';
import { keepTicked, type ChainNode, type ProposedChain } from '@/lib/learn/graph/chain-payload';
import { readLine, type CourseRead } from '@/lib/learn/graph/course-reads';
import { EDUCATION_HREF, type SchoolGroup } from '@/lib/vault/education';
import type { Course } from '@/lib/vault/transcripts';
import {
  approveFromCourse,
  proposeFromCourse,
  type CourseApproveState,
  type CourseState,
} from './actions';

/**
 * Start from your courses (plan #1391, under #1388).
 *
 * Every course saved from a transcript on the vault's Education tab, by school
 * and term, with a button that has Dash list the ideas a course by that name
 * usually teaches. One course at a time: the list gives way to the check
 * screen, which shows the course with its term and grade, every idea with its
 * claim and the line saying it came from this course, and a tick on each new
 * one. Approving keeps the ticked ideas as known in the chosen track, on the
 * person's word as the "what you already know" form does, and marks the course
 * read. Nothing is written before that press.
 *
 * Picking another track asks again rather than relabelling the list, because
 * which ideas a track already holds is part of what came back.
 */

const key = (name: string) => name.trim().toLowerCase();

type Track = { id: string; name: string };

function ReadButton({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? 'Reading…' : again ? 'Read again' : 'Read'}
    </Button>
  );
}

function RetrackButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="ghost" disabled={pending}>
      {pending ? 'Reading…' : 'Read for this track'}
    </Button>
  );
}

function ApproveButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? 'Saving…' : `Approve and mark ${count} known`}
    </Button>
  );
}

function termLabel(term: string | null, year: number | null): string {
  if (!term) return 'No term given';
  return year && !term.includes(String(year)) ? `${term} · ${year}` : term;
}

function CourseRow({
  course,
  read,
  state,
  propose,
}: {
  course: Course;
  read: CourseRead | undefined;
  state: CourseState;
  propose: (formData: FormData) => void;
}) {
  // What came back for this course when it was not a list: a vague title, an
  // idea list the track already holds, or a failed call.
  const said = state.course?.id === course.id && !state.chain ? state : null;

  return (
    <li className="py-2">
      <form action={propose} className="flex items-center justify-between gap-3">
        <input type="hidden" name="courseId" value={course.id} />
        {/* A course read before is read again into the same track, so what
            that track already holds is matched and left alone. */}
        {read?.subject && <input type="hidden" name="subjectId" value={read.subject.id} />}
        <span className="min-w-0">
          <span className="block text-ui text-ink">
            {course.code && <span className="tabular text-ink-muted">{course.code} </span>}
            {course.title}
          </span>
          <span className="block text-small text-ink-muted">
            {[course.grade ? `Grade ${course.grade}` : null, read ? readLine(read) : null]
              .filter(Boolean)
              .join(' · ') || 'Not read yet'}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <ReadButton again={Boolean(read)} />
          <PaidHint
            action="app/learn/know/actions.ts#proposeFromCourse"
            what="Cost of reading the course"
            align="end"
          />
        </span>
      </form>
      {said?.message && <p className="mt-1 text-small text-ink-muted">{said.message}</p>}
      {said?.error && <p className="mt-1 text-small text-danger">{said.error}</p>}
    </li>
  );
}

function SchoolSection({
  group,
  reads,
  state,
  propose,
}: {
  group: SchoolGroup;
  reads: Record<string, CourseRead>;
  state: CourseState;
  propose: (formData: FormData) => void;
}) {
  const courses = group.terms.flatMap((term) => term.courses);
  const done = courses.filter((course) => reads[course.id]).length;

  return (
    <CardSection
      title={group.school}
      hint={`${done} of ${courses.length} ${courses.length === 1 ? 'course' : 'courses'} read`}
    >
      {group.terms.map((term) => (
        <section key={`${term.term ?? ''}|${term.year ?? ''}`} className="mt-3 first:mt-0">
          <h3 className="text-small font-medium text-ink-muted">
            {termLabel(term.term, term.year)}
          </h3>
          <ul className="divide-y divide-border">
            {term.courses.map((course) => (
              <CourseRow
                key={course.id}
                course={course}
                read={reads[course.id]}
                state={state}
                propose={propose}
              />
            ))}
          </ul>
        </section>
      ))}
    </CardSection>
  );
}

function IdeaRow({
  node,
  ticked,
  unplaced,
  onToggle,
}: {
  node: ChainNode;
  ticked: boolean;
  unplaced: boolean;
  onToggle: () => void;
}) {
  if (node.existingId) {
    return (
      <li className="px-4 py-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{node.name}</span>
          {/* No tick: approving writes nothing for an idea the track already
              holds, and its state stays whatever it was. */}
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            Already in this track, left as it is
          </span>
        </p>
        {node.claim && <p className="mt-0.5 text-ui text-ink">{node.claim}</p>}
      </li>
    );
  }

  return (
    <li className="flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={ticked}
        onChange={onToggle}
        name="keep"
        value={node.name}
        aria-label={`I know ${node.name}`}
        className="mt-1 size-4 shrink-0 rounded border-border text-accent focus:ring-accent/30"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{node.name}</span>
          <KindBadge kind={node.kind} />
          {unplaced && (
            <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
              Nothing left to hang it on
            </span>
          )}
        </span>
        {node.claim && <span className="mt-0.5 block text-ui text-ink">{node.claim}</span>}
        {node.basis && <span className="mt-0.5 block text-small text-ink-muted">{node.basis}</span>}
        <MasteryChecks checks={node.mastery} className="mt-1" />
      </span>
    </li>
  );
}

export function CourseCheck({
  course,
  chain,
  subjectId,
  tracks,
  propose,
  onBack,
}: {
  course: { id: string; label: string };
  chain: ProposedChain;
  /** The track the ideas were matched against, or null for a new one. */
  subjectId: string | null;
  tracks: Track[];
  propose: (formData: FormData) => void;
  onBack: () => void;
}) {
  const [state, approve] = useActionState<CourseApproveState, FormData>(approveFromCourse, {});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(chain.nodes.filter((node) => !node.existingId).map((node) => key(node.name))),
  );

  // The rule the server applies on approval, applied here so the cost of
  // unticking an idea is visible before the button is pressed.
  const { chain: kept, unplaced } = useMemo(() => keepTicked(chain, ticked), [chain, ticked]);
  const unplacedNames = new Set(unplaced.map((node) => key(node.name)));
  const adding = kept.nodes.filter((node) => !node.existingId).length;
  const already = chain.nodes.length - chain.nodes.filter((node) => !node.existingId).length;

  return (
    <div className="space-y-4">
      <Card padding="standard">
        <p className="text-small text-ink-muted">Checking</p>
        <p className="text-body font-medium text-ink">{course.label}</p>

        {/* Another track means asking again: the ideas a track already holds
            are matched when the list is made, so the same list cannot simply
            be relabelled. */}
        <form action={propose} className="-ml-1.5 mt-2 flex flex-wrap items-center gap-1">
          <input type="hidden" name="courseId" value={course.id} />
          <ChipSelect
            name="subjectId"
            defaultValue={subjectId ?? ''}
            aria-label="Into which track"
            icon={<Network className="size-3.5" strokeWidth={1.75} />}
          >
            <option value="">
              {subjectId === null ? `A new track: ${chain.subject}` : 'Let Dash choose'}
            </option>
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </ChipSelect>
          <span className="flex items-center gap-1">
            <RetrackButton />
            <PaidHint
              action="app/learn/know/actions.ts#proposeFromCourse"
              what="Cost of reading the course again"
            />
          </span>
        </form>
      </Card>

      <form action={approve}>
        <input type="hidden" name="chain" value={JSON.stringify(chain)} />
        <input type="hidden" name="courseId" value={course.id} />

        <p className="mb-2 text-body text-ink-muted">
          {`What a course by this name usually teaches, for ${chain.subject}${
            already > 0 ? `, beside ${already} the track already holds` : ''
          }. Untick any you do not really know. The rest are marked known on your word, and nothing is saved until you approve.`}
        </p>

        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {chain.nodes.map((node) => (
            <IdeaRow
              key={node.name}
              node={node}
              ticked={ticked.has(key(node.name))}
              unplaced={unplacedNames.has(key(node.name))}
              onToggle={() =>
                setTicked((current) => {
                  const next = new Set(current);
                  if (next.has(key(node.name))) next.delete(key(node.name));
                  else next.add(key(node.name));
                  return next;
                })
              }
            />
          ))}
        </ul>

        {unplaced.length > 0 && (
          <p className="mt-2 text-small text-ink-muted">
            Ticked but not added: {unplaced.map((node) => node.name).join(', ')}. Nothing you kept
            says what {unplaced.length === 1 ? 'it sits' : 'they sit'} under or on top of.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {state.savedTo ? (
            <Link
              href={`/learn/s/${state.savedTo}`}
              className={buttonVariants({ variant: 'primary' })}
            >
              Open {chain.subject}
            </Link>
          ) : (
            <>
              <ApproveButton count={adding} />
              <PaidHint
                action="app/learn/know/actions.ts#approveFromCourse"
                what="Cost of saving them"
              />
            </>
          )}
          <Button type="button" variant="ghost" onClick={onBack}>
            Back to courses
          </Button>
          {state.error && <span className="text-ui text-danger">{state.error}</span>}
          {state.message && <span className="text-ui text-ink-muted">{state.message}</span>}
        </div>
      </form>
    </div>
  );
}

export function FromCoursesForm({
  groups,
  reads,
  tracks,
  failed = false,
}: {
  groups: SchoolGroup[];
  reads: Record<string, CourseRead>;
  tracks: Track[];
  /** The courses could not be read, which is said rather than shown as none. */
  failed?: boolean;
}) {
  const [state, propose] = useActionState<CourseState, FormData>(proposeFromCourse, {});
  const [discarded, setDiscarded] = useState<ProposedChain | null>(null);

  if (failed) {
    return (
      <p className="text-ui text-ink-muted">
        Your courses could not be read, so the list is missing.
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <Card padding="standard">
        <p className="text-ui text-ink">No courses saved yet.</p>
        <p className="mt-1 text-small text-ink-muted">
          Add a transcript on the vault&apos;s Education tab and its courses show up here, each with
          a button that has Dash list the ideas it usually teaches for you to keep as known.
        </p>
        <Link
          href={EDUCATION_HREF}
          className={cn(buttonVariants({ variant: 'secondary' }), 'mt-3')}
        >
          Open Education
        </Link>
      </Card>
    );
  }

  const chain = state.chain;
  if (chain && state.course && chain !== discarded) {
    return (
      <CourseCheck
        key={`${state.course.id}|${state.subjectId ?? ''}|${chain.nodes.map((node) => node.name).join('|')}`}
        course={state.course}
        chain={chain}
        subjectId={state.subjectId ?? null}
        tracks={tracks}
        propose={propose}
        onBack={() => setDiscarded(chain)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <SchoolSection
          key={group.school}
          group={group}
          reads={reads}
          state={state}
          propose={propose}
        />
      ))}
    </div>
  );
}
