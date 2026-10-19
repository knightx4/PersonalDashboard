import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLinkedInArchive, type LinkedInArchive, type MessageRecord } from '@/lib/linkedin/archive';
import { applyPlan, planImport } from '../engine';
import { LINKEDIN_MAPPERS, LINKEDIN_SOURCE } from '../linkedin';
import { memoryStore, type MemoryStore } from '../memory-store';
import { CONNECTION_ONLY } from './applications';
import { INCOMING, NO_NOTE, ONE_WAY, ownSlug } from './connections';

// The fixture export (lib/linkedin/archive/fixtures/build-export.ts) is Sam
// Taylor's. Two connections: Jordan Lee, a recruiter at Acme Robotics, and
// Renée Dubois at Globex, both companies the export applied to. Sam invited
// Renée with "Enjoyed your talk.", and Jordan and Sam traded two messages.

const zip = new Uint8Array(readFileSync(join(__dirname, '../../linkedin/archive/fixtures/export.zip')));

const COMPANIES = 'job_search.companies';
const CONTACTS = 'job_search.contacts';
const TOUCHES = 'job_search.contact_touches';
const PROFILES = 'job_search.profiles';
const ME = '00000000-0000-4000-8000-000000000001';

const SAM = 'https://www.linkedin.com/in/sam-taylor-0a1b2c';

function seeded(extra: Record<string, Record<string, unknown>[]> = {}): MemoryStore {
  return memoryStore({
    [PROFILES]: [{ id: ME, pipeline_view: 'board', target_titles: [], home_location: null, workplace_preferences: [] }],
    ...extra,
  });
}

function archive(): LinkedInArchive {
  const a = readLinkedInArchive(zip);
  a.exportedOn = '2026-09-01';
  return a;
}

function message(conversationId: string, from: [string, string], to: [string, string], sentAt: string, content: string, subject: string | null = null): MessageRecord {
  return {
    key: `${conversationId}:${sentAt}`,
    file: 'messages.csv',
    conversationId,
    conversationTitle: null,
    from: from[0],
    senderProfileUrl: from[1],
    senderProfileSlug: from[1].split('/in/')[1].toLowerCase(),
    to: to[0],
    recipientProfileUrls: [to[1]],
    recipientProfileSlugs: [to[1].split('/in/')[1].toLowerCase()],
    sentAt,
    subject,
    content,
    folder: 'INBOX',
    attachments: null,
    isDraft: false,
  };
}

async function run(store: MemoryStore, input: LinkedInArchive) {
  const plan = await planImport(store, LINKEDIN_SOURCE, LINKEDIN_MAPPERS, input);
  await applyPlan(store, plan, { archiveDate: '2026-09-01' });
  return plan;
}

const kind = (plan: Awaited<ReturnType<typeof run>>, name: string) => plan.kinds.find((k) => k.kind === name)!;

describe('importing connections, invitations and messages', () => {
  it('makes each connection a marked contact at its company, with its touches, and a rerun adds nothing', async () => {
    const store = seeded();
    const plan = await run(store, archive());
    expect(ownSlug(archive())).toBe('sam-taylor-0a1b2c');

    const companies = new Map(store.rows(COMPANIES).map((c) => [c.name, c.id]));
    const contacts = store.rows(CONTACTS);
    const jordan = contacts.find((c) => c.full_name === 'Jordan Lee')!;
    const renee = contacts.find((c) => c.full_name === 'Renée Dubois')!;
    expect(jordan).toMatchObject({ title: 'Recruiter', company_id: companies.get('Acme Robotics'), linkedin_connection: true });
    expect(renee).toMatchObject({ company_id: companies.get('Globex'), email: 'renee@example.com', linkedin_connection: true });

    const touches = store.rows(TOUCHES);
    expect(touches.filter((t) => t.channel === 'linkedin_connect')).toEqual([
      expect.objectContaining({ contact_id: renee.id, direction: 'outbound', message: 'Enjoyed your talk.' }),
    ]);
    const dms = touches.filter((t) => t.channel === 'linkedin_dm').sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
    expect(dms.map((t) => [t.contact_id, t.direction])).toEqual([
      [jordan.id, 'inbound'],
      [jordan.id, 'outbound'],
    ]);
    expect(dms[0].message).toMatch(/^Product Manager role\n\nHi Sam/);
    expect(kind(plan, 'messages').counts).toMatchObject({ added: 2, skipped: 0 });

    const again = await run(store, archive());
    for (const k of ['connections', 'correspondents', 'invitations', 'messages']) {
      expect(kind(again, k).counts).toMatchObject({ added: 0, updated: 0 });
    }
    expect(store.rows(CONTACTS)).toHaveLength(2);
    expect(store.rows(TOUCHES)).toHaveLength(3);
  });

  it('adds only the new message when a later export has one more', async () => {
    const store = seeded();
    await run(store, archive());
    const later = archive();
    later.messages.push(
      message('2-ZmFrZWNvbnZv', ['Jordan Lee', 'https://www.linkedin.com/in/jordan-lee-4b2a1c'], ['Sam Taylor', SAM], '2026-08-25T09:00:00.000Z', 'Confirming Tuesday.'),
    );
    const plan = await run(store, later);
    expect(kind(plan, 'messages').counts).toMatchObject({ added: 1, unchanged: 2 });
    expect(store.rows(TOUCHES)).toHaveLength(4);
  });

  it('joins a contact the person already had, filling its LinkedIn link and leaving it unmarked', async () => {
    const store = seeded({
      [COMPANIES]: [{ id: 'c1', name: 'Acme Robotics', slug: 'acme-robotics', priority: 'target', domains: [] }],
      [CONTACTS]: [
        { id: 'k1', full_name: 'jordan lee', company_id: 'c1', linkedin_url: null, title: 'Talent partner', status: 'contacted', linkedin_connection: false },
      ],
    });
    const plan = await run(store, archive());
    const k1 = store.rows(CONTACTS).find((c) => c.id === 'k1')!;
    expect(k1).toMatchObject({
      linkedin_url: 'https://www.linkedin.com/in/jordan-lee-4b2a1c',
      title: 'Talent partner',
      linkedin_connection: false,
    });
    expect(kind(plan, 'connections').records.find((r) => r.key === 'jordan-lee-4b2a1c')).toMatchObject({ outcome: 'updated', rowId: 'k1' });
    expect(store.rows(CONTACTS).filter((c) => c.full_name === 'Jordan Lee')).toHaveLength(0);
    expect(store.rows(TOUCHES).filter((t) => t.contact_id === 'k1')).toHaveLength(2);
  });

  it('joins by profile URL before company and name', async () => {
    const store = seeded({
      [CONTACTS]: [{ id: 'k2', full_name: 'R. Dubois', company_id: null, linkedin_url: 'https://linkedin.com/in/renée-dubois', status: 'met' }],
    });
    await run(store, archive());
    expect(store.rows(CONTACTS).find((c) => c.id === 'k2')).toMatchObject({ full_name: 'R. Dubois', email: 'renee@example.com' });
    expect(store.rows(CONTACTS).filter((c) => String(c.full_name).includes('Dubois'))).toHaveLength(1);
  });

  it('links a connection to no company when the person does not track its employer', async () => {
    const input = archive();
    input.connections.push({
      key: 'pat-kim',
      file: 'Connections.csv',
      profileSlug: 'pat-kim',
      profileUrl: 'https://www.linkedin.com/in/pat-kim',
      firstName: 'Pat',
      lastName: 'Kim',
      email: null,
      company: 'Hooli',
      position: 'Engineer',
      connectedOn: '2024-02-02',
    });
    input.invitations.push({
      key: 'h:incoming',
      file: 'Invitations.csv',
      from: 'Pat Kim',
      to: 'Sam Taylor',
      sentAt: '2024-02-01T10:00:00.000Z',
      message: 'Met at the meetup',
      direction: 'INCOMING',
      inviterProfileUrl: 'https://www.linkedin.com/in/pat-kim',
      inviterProfileSlug: 'pat-kim',
      inviteeProfileUrl: SAM,
      inviteeProfileSlug: 'sam-taylor-0a1b2c',
    });
    const store = seeded();
    const plan = await run(store, input);
    expect(store.rows(CONTACTS).find((c) => c.full_name === 'Pat Kim')).toMatchObject({
      company_id: null,
      linkedin_connection: true,
      how_we_connect: 'They invited you to connect on LinkedIn: "Met at the meetup"',
    });
    expect(store.rows(COMPANIES).map((c) => c.name)).not.toContain('Hooli');
    expect(kind(plan, 'companies').records.find((r) => r.key === 'hooli')).toMatchObject({ outcome: 'skipped', reason: CONNECTION_ONLY });
    expect(kind(plan, 'invitations').records.find((r) => r.key === 'h:incoming')).toMatchObject({ outcome: 'skipped', reason: INCOMING });

    // Once they track it, the next import links the contact.
    store.tables.get(COMPANIES)!.set('c7', { id: 'c7', name: 'Hooli', slug: 'hooli', priority: 'interested', domains: [] });
    await run(store, input);
    expect(store.rows(CONTACTS).find((c) => c.full_name === 'Pat Kim')).toMatchObject({ company_id: 'c7' });
  });

  it('skips one-way InMail, and keeps a conversation you wrote in with someone not connected', async () => {
    const input = archive();
    const recruiter: [string, string] = ['Alex Recruiter', 'https://www.linkedin.com/in/alex-recruiter'];
    const founder: [string, string] = ['Casey Founder', 'https://www.linkedin.com/in/casey-founder'];
    input.messages.push(
      message('inmail-1', recruiter, ['Sam Taylor', SAM], '2026-08-01T10:00:00.000Z', 'Are you open to a Senior PM role?', 'Senior PM at Initech'),
      message('chat-2', founder, ['Sam Taylor', SAM], '2026-08-02T10:00:00.000Z', 'Coffee?'),
      message('chat-2', ['Sam Taylor', SAM], founder, '2026-08-02T11:00:00.000Z', 'Sure.'),
    );
    const store = seeded();
    const plan = await run(store, input);

    const messages = kind(plan, 'messages');
    expect(messages.records.find((r) => r.key.startsWith('inmail-1'))).toMatchObject({ outcome: 'skipped', reason: ONE_WAY });
    expect(store.rows(CONTACTS).map((c) => c.full_name)).not.toContain('Alex Recruiter');

    const casey = store.rows(CONTACTS).find((c) => c.full_name === 'Casey Founder')!;
    expect(casey).toMatchObject({ linkedin_url: founder[1] });
    expect(casey.linkedin_connection).toBeUndefined();
    expect(store.rows(TOUCHES).filter((t) => t.contact_id === casey.id).map((t) => t.direction).sort()).toEqual(['inbound', 'outbound']);
  });

  it('joins a touch the person logged by hand that day rather than doubling it', async () => {
    const store = seeded({
      [CONTACTS]: [{ id: 'k3', full_name: 'Renée Dubois', linkedin_url: 'https://www.linkedin.com/in/renée-dubois', status: 'contacted' }],
      [TOUCHES]: [{ id: 't1', contact_id: 'k3', channel: 'linkedin_connect', direction: 'outbound', sent_at: '2025-01-03T20:00:00.000Z', message: null }],
    });
    await run(store, archive());
    expect(store.rows(TOUCHES).filter((t) => t.contact_id === 'k3')).toEqual([
      expect.objectContaining({ id: 't1', message: 'Enjoyed your talk.' }),
    ]);
  });

  it('joins a connection note logged by hand as a message the next day', async () => {
    const store = seeded({
      [CONTACTS]: [{ id: 'k3', full_name: 'Renée Dubois', linkedin_url: 'https://www.linkedin.com/in/renée-dubois', status: 'contacted' }],
      [TOUCHES]: [{ id: 't1', contact_id: 'k3', channel: 'linkedin_dm', direction: 'outbound', sent_at: '2025-01-04T02:00:00.000Z', message: null }],
    });
    await run(store, archive());
    expect(store.rows(TOUCHES).filter((t) => t.contact_id === 'k3')).toEqual([
      expect.objectContaining({ id: 't1', channel: 'linkedin_dm', message: 'Enjoyed your talk.' }),
    ]);
  });

  it('does not join a touch two days off, or one on another channel', async () => {
    const store = seeded({
      [CONTACTS]: [{ id: 'k3', full_name: 'Renée Dubois', linkedin_url: 'https://www.linkedin.com/in/renée-dubois', status: 'contacted' }],
      [TOUCHES]: [
        { id: 't1', contact_id: 'k3', channel: 'linkedin_connect', direction: 'outbound', sent_at: '2025-01-05T12:00:00.000Z', message: null },
        { id: 't2', contact_id: 'k3', channel: 'email', direction: 'outbound', sent_at: '2025-01-03T12:00:00.000Z', message: null },
      ],
    });
    await run(store, archive());
    const touches = store.rows(TOUCHES).filter((t) => t.contact_id === 'k3');
    expect(touches).toHaveLength(3);
    expect(touches.find((t) => t.id === 't1')!.message).toBeNull();
    expect(touches.find((t) => t.id === 't2')!.message).toBeNull();
  });

  it('leaves out a connection request sent with no note', async () => {
    const store = seeded();
    const input = archive();
    input.invitations = input.invitations.map((inv) => ({ ...inv, message: null }));
    const plan = await run(store, input);
    expect(store.rows(TOUCHES).filter((t) => t.channel === 'linkedin_connect')).toEqual([]);
    expect(kind(plan, 'invitations').records.filter((r) => r.reason === NO_NOTE)).toHaveLength(1);
  });
});
