/**
 * Draft a message to one person already on file, from their contact page.
 *
 * The people search writes a first message for each stranger it suggests;
 * this writes one for someone the person has already added: a recruiter who
 * wrote in, a friend at a company, an alum. It reads what the page knows about
 * them (title, company, how they connect, the notes, the sends so far and
 * whether they replied), what the person wants from a job, and a few emails
 * they sent for their voice, and follows the same writing rules as the search
 * (MESSAGE_RULES). A send already logged makes it a follow-up.
 *
 * Nothing is stored here. The draft comes back to the page, and it becomes a
 * row only when the person logs it as sent.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { MODELS } from '@/lib/core/models';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { formatDate } from '@/lib/jobs/applications/load';
import { THINKING_ROOM, forceTool, toolBlockIn, whyNoReport } from '@/lib/learn/graph/tool-call';
import { loadSeeker } from '@/lib/jobs/suggest/run';
import { loadVoiceSamples } from '@/lib/jobs/suggest/voice';
import { MESSAGE_RULES, seekerText, type SeekerContext } from '@/lib/jobs/suggest/model';
import { CONNECT_NOTE_MAX, type Channel } from '@/lib/jobs/suggest/payload';

const MODEL = MODELS.jobsOutreachDraft;
const TOOL_NAME = 'report_message';
/** Earlier sends read into the prompt, newest first. */
const TOUCHES_READ = 6;

export type OutreachDraft = { subject: string | null; message: string };

export type OutreachRequest = {
  contactId: string;
  channel: Channel;
  /** What the person wants this message to do, in their words; may be empty. */
  aim: string;
};

type ContactFacts = {
  name: string;
  title: string | null;
  company: string | null;
  relationship: string;
  howWeConnect: string | null;
  notes: string | null;
  touches: { channel: string; direction: string; sentAt: string; replied: boolean; message: string | null }[];
  applications: { role: string; status: string }[];
};

const CHANNEL_WORDS: Record<Channel, string> = {
  linkedin_dm: 'a LinkedIn message',
  linkedin_connect: `a LinkedIn connection note (at most ${CONNECT_NOTE_MAX} characters)`,
  email: 'an email',
  intro: 'a message asking for, or following, an introduction',
  event: 'what to say when they meet at an event',
  other: 'a short message',
};

function system(seeker: SeekerContext): string {
  return `You write one message from someone in a job search to a person they
already have on file. Write it in their voice, ready to send.

${MESSAGE_RULES}

These rules are written for a stranger. Adjust them to who this is:
- A recruiter who wrote to them first: answer what was asked, plainly, and
  say what they want next. Asking about the role or for a call is fine here.
- Someone they know (a friend, a former colleague): write as they would to
  them, warmer and shorter, and asking for an introduction is fine.
- When there are earlier sends with no reply, this is a follow-up: shorter
  than the first, one new reason to answer, no guilt and no "just following
  up" or "bumping this".
- When the person says what the message is for, that comes first.

Write only the message. For an email, put the subject in subject and leave
it out of message; for anything else, subject is null. Do not use these
anywhere: ${[...seeker.banned, '—'].map((b) => `"${b}"`).join(', ')}.${
    seeker.writingStyle ? `\n\nHow they like their writing to sound: ${seeker.writingStyle}` : ''
  }`;
}

function contactText(contact: ContactFacts, timezone: string): string {
  const lines = [`Who it goes to: ${contact.name}`];
  if (contact.title) lines.push(`Their title: ${contact.title}`);
  if (contact.company) lines.push(`Their company: ${contact.company}`);
  lines.push(`How they know each other: ${contact.relationship.replace(/_/g, ' ')}`);
  if (contact.howWeConnect) lines.push(`How they connect: ${contact.howWeConnect}`);
  if (contact.notes) lines.push('', 'Their notes on this person:', contact.notes);
  if (contact.applications.length > 0) {
    lines.push('', `Their applications at ${contact.company ?? 'this company'}:`);
    for (const app of contact.applications) lines.push(`- ${app.role} (${app.status.replace(/_/g, ' ')})`);
  }
  if (contact.touches.length === 0) {
    lines.push('', 'Nothing sent to or from them yet.');
  } else {
    lines.push('', 'Messages so far, newest first:');
    for (const touch of contact.touches) {
      const head = `- ${formatDate(touch.sentAt, timezone)}, ${touch.direction === 'outbound' ? 'they sent' : 'received'}, ${touch.channel.replace(/_/g, ' ')}${touch.direction === 'outbound' ? (touch.replied ? ', answered' : ', no reply') : ''}`;
      lines.push(touch.message ? `${head}: ${touch.message}` : head);
    }
  }
  return lines.join('\n');
}

function voiceText(samples: readonly string[]): string {
  if (samples.length === 0) return '';
  const blocks = samples.map((sample, i) => `Sample ${i + 1}:\n${sample}`);
  return `\n\nEmails they wrote themselves, for how they sound (not what to say):\n\n${blocks.join('\n\n')}`;
}

async function loadContact(
  supabase: AppSupabaseClient,
  userId: string,
  contactId: string,
): Promise<ContactFacts | null> {
  const { data: row } = await supabase
    .from('contacts')
    .select('full_name, title, relationship, how_we_connect, notes, company_id, companies ( name )')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!row) return null;
  const contact = row as unknown as {
    full_name: string;
    title: string | null;
    relationship: string;
    how_we_connect: string | null;
    notes: string | null;
    company_id: string | null;
    companies: { name: string } | null;
  };

  const [touches, applications] = await Promise.all([
    supabase
      .from('contact_touches')
      .select('channel, direction, sent_at, responded_at, message')
      .eq('contact_id', contactId)
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(TOUCHES_READ),
    contact.company_id
      ? supabase
          .from('applications')
          .select('status, roles!inner ( title, company_id )')
          .eq('user_id', userId)
          .eq('roles.company_id', contact.company_id)
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    name: contact.full_name,
    title: contact.title,
    company: contact.companies?.name ?? null,
    relationship: contact.relationship,
    howWeConnect: contact.how_we_connect,
    notes: contact.notes,
    touches: ((touches.data ?? []) as Record<string, unknown>[]).map((t) => ({
      channel: t.channel as string,
      direction: t.direction as string,
      sentAt: t.sent_at as string,
      replied: t.responded_at !== null,
      message: (t.message as string | null) ?? null,
    })),
    applications: ((applications.data ?? []) as unknown as { status: string; roles: { title: string } | null }[])
      .filter((a) => a.roles)
      .map((a) => ({ role: a.roles!.title, status: a.status })),
  };
}

export type DraftOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; record it as 'draft-outreach'. */
  onSpend?: SpendSink;
};

/** One model call: the message to send this contact on this channel. */
export async function draftOutreach(
  supabase: AppSupabaseClient,
  userId: string,
  request: OutreachRequest,
  options: DraftOptions,
): Promise<{ ok: true; draft: OutreachDraft } | { ok: false; error: string }> {
  const [contact, seeker, voice, profile] = await Promise.all([
    loadContact(supabase, userId, request.contactId),
    loadSeeker(supabase, userId),
    loadVoiceSamples(supabase.schema('core') as unknown as CoreSupabaseClient, userId),
    supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
  ]);
  if (!contact) return { ok: false, error: 'That contact is not on file.' };
  const timezone = ((profile.data as { timezone?: string } | null)?.timezone as string) ?? 'UTC';

  const aim = request.aim.trim();
  const prompt =
    seekerText(seeker) +
    '\n\n' +
    contactText(contact, timezone) +
    voiceText(voice) +
    `\n\nWrite ${CHANNEL_WORDS[request.channel]} to ${contact.name}.` +
    (aim ? ` What it is for, in their words: ${aim}` : '') +
    `\n\nCall ${TOOL_NAME}.`;

  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1_500 + THINKING_ROOM,
      system: system(seeker),
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the message, ready to send.',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: ['string', 'null'] },
              message: { type: 'string' },
            },
            required: ['subject', 'message'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Dash is rate-limited right now. Try again in a minute.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `The draft failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'The draft failed.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const report = toolBlockIn(response, TOOL_NAME);
  if (!report || report.type !== 'tool_use') return { ok: false, error: whyNoReport(response) };
  const input = report.input as { subject?: unknown; message?: unknown };
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) return { ok: false, error: 'Dash wrote nothing back. Try again.' };
  const subject =
    request.channel === 'email' && typeof input.subject === 'string' && input.subject.trim()
      ? input.subject.trim()
      : null;
  return { ok: true, draft: { subject, message } };
}
