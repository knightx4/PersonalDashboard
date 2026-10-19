import { profileSlugFromUrl, type ConnectionRecord, type LinkedInArchive, type MessageRecord } from '@/lib/linkedin/archive';
import { companyNameKey } from '@/lib/jobs/companies/same-company';
import { ref } from '../engine';
import type { ImportMapper, ImportStore, MappedRecord, MatchSkip, PendingRecord } from '../types';

// LinkedIn connections, invitations and messages into Jobs (plan #2432.5).
//
//   connections     every connection a contact (#2432.3), marked
//                   linkedin_connection. Its employer is linked when the
//                   person tracks it: the companies mapper offers each
//                   employer as join-only, and the ref here is orNull. A
//                   contact the person already had is joined by profile URL,
//                   then email, then company and name; the join fills only
//                   empty columns, so it gains linkedin_url where blank and
//                   its linkedin_connection stays false (it was theirs first,
//                   and stays visible with LinkedIn connections left out).
//                   An incoming invitation sets how_we_connect.
//   correspondents  the other person in a conversation you wrote in who is
//                   not a connection, so the touches have a contact. Never
//                   marked linkedin_connection, and only joined by URL.
//   invitations     an outgoing invitation to a connection that carried a
//                   note: a touch on linkedin_connect, outbound, with the
//                   note. A bare connection request is not outreach and is
//                   skipped.
//   messages        one touch on linkedin_dm per message of a one-to-one
//                   conversation you wrote in or held with a connection.
//                   The rest (one-way recruiter and sales InMail, mostly)
//                   are counted as skipped and not imported.
//
// Keys: a contact's is its profile slug; an invitation's and a message's are
// the reader's (a message's is the conversation id and a hash of its date,
// sender and text), so a rerun adds only the new messages.

const CONTACTS = 'job_search.contacts';
const TOUCHES = 'job_search.contact_touches';
const CONTACT_STATUSES = ['to_contact', 'contacted', 'responded', 'met', 'dormant'];

export const ONE_WAY =
  'A one-way message, mostly recruiter or sales InMail: you never wrote in the conversation and they are not a connection.';
export const GROUP = 'A group conversation: touches are kept for one-to-one conversations.';
export const NOT_YOU = 'The export does not say which side of the conversation is you.';
export const NOT_CONNECTED = 'They are not one of your connections, so there is no contact to put it on.';
export const INCOMING = 'An invitation they sent you: it sets how you connected on their contact, not a touch.';
export const NO_NOTE = 'A connection request with no note, which is not outreach.';

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

function fullName(c: ConnectionRecord): string | null {
  return str([c.firstName, c.lastName].filter(Boolean).join(' '));
}

/** The company key a connection's employer has in the companies mapper, or null. */
function employerKey(name: string | null): string | null {
  const trimmed = name?.trim();
  return trimmed ? companyNameKey(trimmed) || null : null;
}

/**
 * The person's own profile slug: the inviter of an outgoing invitation or the
 * invitee of an incoming one, else whoever is in the most conversations.
 */
export function ownSlug(archive: LinkedInArchive): string | null {
  for (const inv of archive.invitations) {
    if (inv.direction === 'OUTGOING' && inv.inviterProfileSlug) return inv.inviterProfileSlug;
    if (inv.direction === 'INCOMING' && inv.inviteeProfileSlug) return inv.inviteeProfileSlug;
  }
  const seen = new Map<string, Set<string>>();
  for (const m of archive.messages) {
    if (!m.conversationId) continue;
    for (const slug of [m.senderProfileSlug, ...m.recipientProfileSlugs]) {
      if (!slug) continue;
      if (!seen.has(slug)) seen.set(slug, new Set());
      seen.get(slug)!.add(m.conversationId);
    }
  }
  const ranked = [...seen].map(([slug, convs]) => [slug, convs.size] as const).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][1] > 1 ? ranked[0][0] : null;
}

export interface Conversation {
  id: string;
  messages: MessageRecord[];
  /** The one other person's slug, when there is exactly one. */
  other: string | null;
  /** How many other people it has. */
  others: number;
  /** Whether you wrote in it. */
  wrote: boolean;
  /** The other person's name and profile URL as the messages give them. */
  name: string | null;
  url: string | null;
}

/** The export's conversations, with who is in each. */
export function conversations(archive: LinkedInArchive, self: string | null): Conversation[] {
  const byId = new Map<string, MessageRecord[]>();
  for (const m of archive.messages) {
    if (!m.conversationId) continue;
    if (!byId.has(m.conversationId)) byId.set(m.conversationId, []);
    byId.get(m.conversationId)!.push(m);
  }
  return [...byId].map(([id, messages]) => {
    const others = new Set<string>();
    let name: string | null = null;
    let url: string | null = null;
    for (const m of messages) {
      if (m.senderProfileSlug && m.senderProfileSlug !== self) {
        others.add(m.senderProfileSlug);
        name ??= str(m.from);
        url ??= m.senderProfileUrl;
      }
      m.recipientProfileSlugs.forEach((slug, i) => {
        if (slug === self) return;
        others.add(slug);
        if (m.recipientProfileSlugs.length === 1) name ??= str(m.to);
        url ??= m.recipientProfileUrls.find((u) => profileSlugFromUrl(u) === slug) ?? m.recipientProfileUrls[i] ?? null;
      });
    }
    const wrote = !!self && messages.some((m) => m.senderProfileSlug === self && !m.isDraft);
    return { id, messages, other: others.size === 1 ? [...others][0] : null, others: others.size, wrote, name, url };
  });
}

/** Every contact the person has, for matching. */
async function everyContact(store: ImportStore): Promise<Record<string, unknown>[]> {
  return store.rowsWhere(CONTACTS, ['full_name', 'linkedin_url', 'email', 'company_id'], 'status', CONTACT_STATUSES);
}

const nameAt = (companyId: unknown, name: unknown) =>
  companyId ? `${companyId}|${String(name ?? '').trim().toLowerCase()}` : null;

// ── contacts ────────────────────────────────────────────────────────────────

export const linkedInConnections: ImportMapper<LinkedInArchive> = {
  kind: 'connections',
  table: CONTACTS,
  columns: {
    full_name: 'text',
    title: 'text',
    company_id: 'uuid',
    linkedin_url: 'text',
    email: 'text',
    how_we_connect: 'text',
    linkedin_connection: 'boolean',
  },
  records(archive) {
    // An invitation they sent you is how you connected.
    const invitedBy = new Map<string, string>();
    for (const inv of archive.invitations) {
      if (inv.direction !== 'INCOMING' || !inv.inviterProfileSlug || invitedBy.has(inv.inviterProfileSlug)) continue;
      const note = str(inv.message);
      invitedBy.set(inv.inviterProfileSlug, note ? `They invited you to connect on LinkedIn: "${note}"` : 'They invited you to connect on LinkedIn.');
    }
    return archive.connections.map((c): MappedRecord => {
      const name = fullName(c);
      if (!name) return { key: c.key, skip: 'It has no name.' };
      const employer = employerKey(c.company);
      return {
        key: c.key,
        values: {
          full_name: name,
          title: str(c.position),
          company_id: employer ? ref('companies', employer, { orNull: true }) : null,
          linkedin_url: c.profileUrl,
          email: str(c.email),
          how_we_connect: (c.profileSlug && invitedBy.get(c.profileSlug)) ?? null,
          linkedin_connection: true,
        },
      };
    });
  },
  async match(pending, store) {
    const mine = await everyContact(store);
    const bySlug = new Map<string, string>();
    const byEmail = new Map<string, string>();
    const byNameAt = new Map<string, string>();
    for (const c of mine) {
      const id = String(c.id);
      const slug = profileSlugFromUrl(str(c.linkedin_url));
      if (slug && !bySlug.has(slug)) bySlug.set(slug, id);
      const email = str(c.email)?.toLowerCase();
      if (email && !byEmail.has(email)) byEmail.set(email, id);
      const k = nameAt(c.company_id, c.full_name);
      if (k && !byNameAt.has(k)) byNameAt.set(k, id);
    }
    const out = new Map<string, string | MatchSkip>();
    // A row is joined or added once: the unique indexes on email and on
    // company and name would refuse a second.
    const taken = new Set<string>();
    const emails = new Set<string>();
    const names = new Set<string>();
    for (const p of pending) {
      const slug = profileSlugFromUrl(str(p.values.linkedin_url));
      const email = str(p.values.email)?.toLowerCase() ?? null;
      const k = nameAt(p.values.company_id, p.values.full_name);
      const id = (slug && bySlug.get(slug)) || (email && byEmail.get(email)) || (k && byNameAt.get(k)) || null;
      if (id) {
        if (taken.has(id)) out.set(p.key, { skip: 'Another connection in the export is the same contact.' });
        else {
          taken.add(id);
          out.set(p.key, id);
        }
        continue;
      }
      if ((email && emails.has(email)) || (k && names.has(k))) {
        out.set(p.key, { skip: 'Another connection in the export has the same email, or the same name at the same company.' });
        continue;
      }
      if (email) emails.add(email);
      if (k) names.add(k);
    }
    return out;
  },
};

export const linkedInCorrespondents: ImportMapper<LinkedInArchive> = {
  kind: 'correspondents',
  table: CONTACTS,
  columns: { full_name: 'text', linkedin_url: 'text' },
  records(archive) {
    const connected = new Set(archive.connections.map((c) => c.profileSlug).filter(Boolean));
    const out: MappedRecord[] = [];
    const seen = new Set<string>();
    for (const conv of conversations(archive, ownSlug(archive))) {
      if (!conv.wrote || !conv.other || connected.has(conv.other) || seen.has(conv.other)) continue;
      seen.add(conv.other);
      out.push(
        conv.name
          ? { key: conv.other, values: { full_name: conv.name, linkedin_url: conv.url } }
          : { key: conv.other, skip: 'The conversation does not give their name.' },
      );
    }
    return out;
  },
  async match(pending, store) {
    const bySlug = new Map<string, string>();
    for (const c of await everyContact(store)) {
      const slug = profileSlugFromUrl(str(c.linkedin_url));
      if (slug && !bySlug.has(slug)) bySlug.set(slug, String(c.id));
    }
    const out = new Map<string, string>();
    for (const p of pending) {
      const id = bySlug.get(p.key);
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

// ── touches ─────────────────────────────────────────────────────────────────

const day = (value: unknown): string | null => {
  const t = Date.parse(String(value ?? ''));
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};

/**
 * Touches the person already logged that a record should join: the same
 * contact, channel and direction on the same day, each joined once.
 */
async function matchTouches(pending: PendingRecord[], store: ImportStore): Promise<Map<string, string>> {
  const ids = [...new Set(pending.map((p) => String(p.values.contact_id)))];
  const logged: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    logged.push(
      ...(await store.rowsWhere(TOUCHES, ['contact_id', 'channel', 'direction', 'sent_at'], 'contact_id', ids.slice(i, i + 100))),
    );
  }
  // A touch logged by hand often names the other LinkedIn channel (a
  // connection note logged as a message) or the next day (an evening message
  // is the next day in UTC). Each record takes the closest free touch: the
  // same channel on the same day first, then either LinkedIn channel a day
  // either side. A touch on another channel, such as email, never joins.
  const linkedIn = (channel: unknown) => channel === 'linkedin_dm' || channel === 'linkedin_connect';
  const slot = (t: Record<string, unknown>, at: string | null) => `${t.contact_id}|${t.direction}|${at}`;
  const free = new Map<string, Record<string, unknown>[]>();
  for (const t of logged) {
    if (!linkedIn(t.channel)) continue;
    const k = slot(t, day(t.sent_at));
    if (!free.has(k)) free.set(k, []);
    free.get(k)!.push(t);
  }
  const taken = new Set<string>();
  const take = (k: string, sameChannel: unknown): string | null => {
    const t = free.get(k)?.find((c) => !taken.has(String(c.id)) && (sameChannel === null || c.channel === sameChannel));
    if (!t) return null;
    taken.add(String(t.id));
    return String(t.id);
  };
  const out = new Map<string, string>();
  for (const pass of ['exact', 'near'] as const) {
    for (const p of pending) {
      if (out.has(p.key)) continue;
      const on = day(p.values.sent_at);
      if (!on) continue;
      const id =
        pass === 'exact'
          ? take(slot(p.values, on), p.values.channel)
          : [on, shiftDay(on, -1), shiftDay(on, 1)].reduce<string | null>((hit, d) => hit ?? take(slot(p.values, d), null), null);
      if (id) out.set(p.key, id);
    }
  }
  return out;
}

const shiftDay = (on: string, by: number): string => new Date(Date.parse(`${on}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

const TOUCH_COLUMNS = {
  contact_id: 'uuid',
  channel: 'text',
  direction: 'text',
  sent_at: 'timestamptz',
  message: 'text',
} as const;

export const linkedInInvitations: ImportMapper<LinkedInArchive> = {
  kind: 'invitations',
  table: TOUCHES,
  columns: TOUCH_COLUMNS,
  records(archive) {
    const connected = new Set(archive.connections.map((c) => c.profileSlug).filter(Boolean));
    return archive.invitations.map((inv): MappedRecord => {
      if (inv.direction !== 'OUTGOING') return { key: inv.key, skip: INCOMING };
      const slug = inv.inviteeProfileSlug;
      if (!slug || !connected.has(slug)) return { key: inv.key, skip: NOT_CONNECTED };
      if (!str(inv.message)) return { key: inv.key, skip: NO_NOTE };
      if (!inv.sentAt) return { key: inv.key, skip: 'It has no date.' };
      return {
        key: inv.key,
        values: {
          contact_id: ref('connections', slug),
          channel: 'linkedin_connect',
          direction: 'outbound',
          sent_at: inv.sentAt,
          message: str(inv.message),
        },
      };
    });
  },
  match: matchTouches,
};

/** The text a touch keeps of a message: its subject, then its content. */
function messageText(m: MessageRecord): string | null {
  const subject = str(m.subject);
  const content = m.content?.trim() || null;
  if (subject && content) return `${subject}\n\n${content}`;
  return subject ?? content;
}

export const linkedInMessages: ImportMapper<LinkedInArchive> = {
  kind: 'messages',
  table: TOUCHES,
  columns: TOUCH_COLUMNS,
  records(archive) {
    const self = ownSlug(archive);
    const connected = new Set(archive.connections.map((c) => c.profileSlug).filter(Boolean));
    const out: MappedRecord[] = archive.messages
      .filter((m) => !m.conversationId)
      .map((m) => ({ key: m.key, skip: 'It belongs to no conversation.' }));
    for (const conv of conversations(archive, self)) {
      const other = conv.other;
      const why = !self
        ? NOT_YOU
        : conv.others > 1
          ? GROUP
          : !other
            ? 'It names nobody else.'
            : !conv.wrote && !connected.has(other)
              ? ONE_WAY
              : null;
      for (const m of conv.messages) {
        if (why) out.push({ key: m.key, skip: why });
        else if (m.isDraft) out.push({ key: m.key, skip: 'A draft, never sent.' });
        else if (!m.sentAt) out.push({ key: m.key, skip: 'It has no date.' });
        else
          out.push({
            key: m.key,
            values: {
              contact_id: ref(connected.has(other!) ? 'connections' : 'correspondents', other!),
              channel: 'linkedin_dm',
              direction: m.senderProfileSlug === self ? 'outbound' : 'inbound',
              sent_at: m.sentAt,
              message: messageText(m),
            },
          });
      }
    }
    return out;
  },
  match: matchTouches,
};

/** In the order the engine must run them, after the companies mapper. */
export const LINKEDIN_CONNECTION_MAPPERS: ImportMapper<LinkedInArchive>[] = [
  linkedInConnections,
  linkedInCorrespondents,
  linkedInInvitations,
  linkedInMessages,
];
