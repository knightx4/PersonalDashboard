/**
 * SQL and TypeScript must agree about status.
 *
 * public.sync_application_state() owns the column; lib/pipeline.ts owns every
 * number computed from it. Two implementations of one rule always drift, so
 * this replays the same event sequences through both and asserts they match.
 * When it fails, one of the two is wrong -- decide which, then fix that one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-jobs';
import {
  deriveApplicationState,
  type ApplicationEventKind,
  type ApplicationStatus,
  type PipelineEvent,
} from '@/lib/jobs/pipeline';

type Case = {
  name: string;
  events: Array<{
    kind: ApplicationEventKind;
    daysAgo: number;
    source: 'email' | 'manual' | 'system';
    interviewKind?: string;
  }>;
  manualOverride?: ApplicationStatus;
  expected: ApplicationStatus;
};

const CASES: Case[] = [
  {
    name: 'a saved role with no events is a lead',
    events: [],
    expected: 'lead',
  },
  {
    name: 'submitted, no confirmation yet',
    events: [{ kind: 'submitted', daysAgo: 3, source: 'manual' }],
    expected: 'submitted',
  },
  {
    name: 'an auto-ack acknowledges but does not advance further',
    events: [
      { kind: 'submitted', daysAgo: 5, source: 'manual' },
      { kind: 'confirmation', daysAgo: 5, source: 'email' },
    ],
    expected: 'acknowledged',
  },
  {
    name: 'a recruiter reply puts it in process',
    events: [
      { kind: 'submitted', daysAgo: 9, source: 'manual' },
      { kind: 'confirmation', daysAgo: 9, source: 'email' },
      { kind: 'recruiter_reply', daysAgo: 6, source: 'email' },
    ],
    expected: 'in_process',
  },
  {
    name: 'an onsite promotes to final round',
    events: [
      { kind: 'submitted', daysAgo: 20, source: 'manual' },
      { kind: 'recruiter_reply', daysAgo: 15, source: 'email' },
      { kind: 'interview_scheduled', daysAgo: 4, source: 'email', interviewKind: 'onsite' },
    ],
    expected: 'final_round',
  },
  {
    name: 'a technical screen does not promote to final round',
    events: [
      { kind: 'submitted', daysAgo: 20, source: 'manual' },
      { kind: 'interview_scheduled', daysAgo: 4, source: 'email', interviewKind: 'technical' },
    ],
    expected: 'in_process',
  },
  {
    name: 'an offer is an offer',
    events: [
      { kind: 'submitted', daysAgo: 25, source: 'manual' },
      { kind: 'recruiter_reply', daysAgo: 20, source: 'email' },
      { kind: 'offer', daysAgo: 2, source: 'email' },
    ],
    expected: 'offer',
  },
  {
    name: 'a rejection is terminal',
    events: [
      { kind: 'submitted', daysAgo: 20, source: 'manual' },
      { kind: 'confirmation', daysAgo: 20, source: 'email' },
      { kind: 'rejection', daysAgo: 3, source: 'email' },
    ],
    expected: 'rejected',
  },
  {
    name: 'mail arriving after a rejection does not reopen it',
    events: [
      { kind: 'submitted', daysAgo: 20, source: 'manual' },
      { kind: 'rejection', daysAgo: 6, source: 'email' },
      { kind: 'recruiter_reply', daysAgo: 1, source: 'email' },
    ],
    expected: 'rejected',
  },
  {
    name: 'a withdrawal is terminal too',
    events: [
      { kind: 'submitted', daysAgo: 12, source: 'manual' },
      { kind: 'withdrawal', daysAgo: 2, source: 'manual' },
    ],
    expected: 'withdrawn',
  },
  {
    name: 'silence past the threshold ghosts it, with nobody touching anything',
    events: [
      { kind: 'submitted', daysAgo: 70, source: 'manual' },
      { kind: 'confirmation', daysAgo: 70, source: 'email' },
    ],
    expected: 'ghosted',
  },
  {
    name: 'a lead that has sat for months is still a lead, not a ghost',
    events: [{ kind: 'note', daysAgo: 200, source: 'manual' }],
    expected: 'lead',
  },
  {
    name: 'an outstanding offer is never ghosted',
    events: [
      { kind: 'submitted', daysAgo: 120, source: 'manual' },
      { kind: 'offer', daysAgo: 90, source: 'email' },
    ],
    expected: 'offer',
  },
  {
    name: 'a manual override wins over the derivation',
    events: [
      { kind: 'submitted', daysAgo: 4, source: 'manual' },
      { kind: 'status_override', daysAgo: 1, source: 'manual' },
    ],
    manualOverride: 'drafting',
    expected: 'drafting',
  },
  {
    name: 'email arriving after an override supersedes it',
    events: [
      { kind: 'submitted', daysAgo: 10, source: 'manual' },
      { kind: 'status_override', daysAgo: 6, source: 'manual' },
      { kind: 'recruiter_reply', daysAgo: 2, source: 'email' },
    ],
    manualOverride: 'drafting',
    expected: 'in_process',
  },
  {
    name: 'email predating an override does not supersede it',
    events: [
      { kind: 'submitted', daysAgo: 10, source: 'manual' },
      { kind: 'confirmation', daysAgo: 9, source: 'email' },
      { kind: 'status_override', daysAgo: 2, source: 'manual' },
    ],
    manualOverride: 'withdrawn',
    expected: 'withdrawn',
  },
];

let userId: string;
let companyId: string;

function toPipelineEvents(spec: Case): PipelineEvent[] {
  return spec.events.map((event) => ({
    kind: event.kind,
    occurredAt: new Date(Date.now() - event.daysAgo * 24 * 60 * 60 * 1000),
    source: event.source,
    payload: event.interviewKind ? { interviewKind: event.interviewKind } : null,
  }));
}

async function runInDatabase(spec: Case): Promise<ApplicationStatus> {
  const [role] = await admin<{ id: string }[]>`
    insert into roles (user_id, company_id, title)
    values (${userId}, ${companyId}, ${spec.name})
    returning id`;

  const [application] = await admin<{ id: string }[]>`
    insert into applications (user_id, role_id)
    values (${userId}, ${role.id})
    returning id`;

  for (const event of spec.events) {
    await admin`
      insert into application_events (user_id, application_id, kind, occurred_at, source, payload)
      values (
        ${userId},
        ${application.id},
        ${event.kind}::application_event_kind,
        now() - make_interval(days => ${event.daysAgo}),
        ${event.source}::event_source,
        ${event.interviewKind ? admin.json({ interview_kind: event.interviewKind }) : null}
      )`;
  }

  if (spec.manualOverride) {
    await admin`
      update applications set status_manual_override = ${spec.manualOverride}::application_status
      where id = ${application.id}`;
  }

  const [row] = await admin<{ status: ApplicationStatus }[]>`
    select status from applications where id = ${application.id}`;
  return row.status;
}

beforeAll(async () => {
  await truncateAll();
  userId = await createUser('status@example.com');
  const [company] = await admin<{ id: string }[]>`
    insert into companies (user_id, name, slug) values (${userId}, 'Statuscorp', 'statuscorp')
    returning id`;
  companyId = company.id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('status derivation', () => {
  for (const spec of CASES) {
    it(`${spec.name} — in TypeScript`, () => {
      const state = deriveApplicationState(toPipelineEvents(spec), {
        manualOverride: spec.manualOverride ?? null,
        ghostThresholdDays: 30,
      });
      expect(state.status).toBe(spec.expected);
    });

    it(`${spec.name} — in Postgres`, async () => {
      expect(await runInDatabase(spec)).toBe(spec.expected);
    });
  }
});

describe('derived timestamps agree across both implementations', () => {
  it('never sets first_human_response_at from an automated confirmation', async () => {
    const spec: Case = {
      name: 'auto-ack only',
      events: [
        { kind: 'submitted', daysAgo: 4, source: 'manual' },
        { kind: 'confirmation', daysAgo: 4, source: 'email' },
      ],
      expected: 'acknowledged',
    };

    const [role] = await admin<{ id: string }[]>`
      insert into roles (user_id, company_id, title) values (${userId}, ${companyId}, 'auto-ack')
      returning id`;
    const [application] = await admin<{ id: string }[]>`
      insert into applications (user_id, role_id) values (${userId}, ${role.id}) returning id`;
    for (const event of spec.events) {
      await admin`
        insert into application_events (user_id, application_id, kind, occurred_at, source)
        values (${userId}, ${application.id}, ${event.kind}::application_event_kind,
                now() - make_interval(days => ${event.daysAgo}), ${event.source}::event_source)`;
    }

    const [row] = await admin<{
      first_human_response_at: string | null;
      confirmation_received_at: string | null;
    }[]>`
      select first_human_response_at, confirmation_received_at
      from applications where id = ${application.id}`;

    expect(row.first_human_response_at).toBeNull();
    expect(row.confirmation_received_at).not.toBeNull();

    const state = deriveApplicationState(toPipelineEvents(spec), { ghostThresholdDays: 30 });
    expect(state.firstHumanResponseAt).toBeNull();
    expect(state.confirmationReceivedAt).not.toBeNull();
  });

  it('infers the same rejection stage on both sides', async () => {
    const spec: Case = {
      name: 'rejected after an onsite',
      events: [
        { kind: 'submitted', daysAgo: 30, source: 'manual' },
        { kind: 'confirmation', daysAgo: 30, source: 'email' },
        { kind: 'recruiter_reply', daysAgo: 25, source: 'email' },
        { kind: 'interview_completed', daysAgo: 10, source: 'manual', interviewKind: 'onsite' },
        { kind: 'rejection', daysAgo: 2, source: 'email' },
      ],
      expected: 'rejected',
    };

    const status = await runInDatabase(spec);
    expect(status).toBe('rejected');

    const [row] = await admin<{ rejection_stage: string | null }[]>`
      select a.rejection_stage from applications a
      join roles r on r.id = a.role_id
      where r.title = ${spec.name}`;

    const state = deriveApplicationState(toPipelineEvents(spec), { ghostThresholdDays: 30 });
    expect(state.rejectionStage).toBe('final');
    expect(row.rejection_stage).toBe(state.rejectionStage);
  });

  it('flags the post-rejection email rather than applying it', async () => {
    const spec: Case = {
      name: 'stray mail after rejection',
      events: [
        { kind: 'submitted', daysAgo: 20, source: 'manual' },
        { kind: 'rejection', daysAgo: 6, source: 'email' },
        { kind: 'recruiter_reply', daysAgo: 1, source: 'email' },
      ],
      expected: 'rejected',
    };

    await runInDatabase(spec);

    const flagged = await admin<{ kind: string }[]>`
      select e.kind from application_events e
      join applications a on a.id = e.application_id
      join roles r on r.id = a.role_id
      where r.title = ${spec.name} and e.needs_review`;

    expect(flagged.map((f) => f.kind)).toEqual(['recruiter_reply']);

    const state = deriveApplicationState(toPipelineEvents(spec), { ghostThresholdDays: 30 });
    expect(state.flaggedEventIndexes).toEqual([2]);
  });
});
