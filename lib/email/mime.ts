/**
 * Decode a Gmail API message payload into plain text (ephemeral — never persist).
 */

interface MimePart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: MimePart[];
}

/** A calendar part Gmail did not inline, to be fetched by attachment id. */
export interface CalendarAttachmentRef {
  attachmentId: string;
  filename: string | null;
  sizeBytes: number | null;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/**
 * Whether this part is a calendar body.
 *
 * Three shapes in the wild and all of them matter: `text/calendar` inline
 * (Google, Outlook), `application/ics` as an attachment (some ATS vendors),
 * and `application/octet-stream` with a `.ics` filename (senders who set no
 * type at all). Matching only the first loses the invite from exactly the
 * vendors whose prose is hardest to read.
 */
function isCalendarPart(part: MimePart): boolean {
  const mime = (part.mimeType ?? '').toLowerCase();
  if (mime.includes('text/calendar') || mime.includes('application/ics')) return true;
  return /\.ics$/i.test(part.filename ?? '');
}

interface PartSink {
  text: string[];
  html: string[];
  calendar: string[];
  calendarRefs: CalendarAttachmentRef[];
}

function collectParts(part: MimePart | undefined, out: PartSink) {
  if (!part) return;
  const mime = (part.mimeType ?? '').toLowerCase();
  const calendar = isCalendarPart(part);

  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (calendar) out.calendar.push(decoded);
    else if (mime.includes('text/plain')) out.text.push(decoded);
    else if (mime.includes('text/html')) out.html.push(decoded);
  } else if (calendar && part.body?.attachmentId) {
    // Gmail inlines small parts and holds larger ones behind an id. An invite
    // with a long description lands on the far side of that line.
    out.calendarRefs.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename ?? null,
      sizeBytes: part.body.size ?? null,
    });
  }

  for (const child of part.parts ?? []) collectParts(child, out);
}

function emptySink(): PartSink {
  return { text: [], html: [], calendar: [], calendarRefs: [] };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function gmailPayloadToText(payload: MimePart | undefined): string {
  const out = emptySink();
  collectParts(payload, out);
  if (out.text.length) return out.text.join('\n\n');
  if (out.html.length) return htmlToText(out.html.join('\n'));
  return '';
}

/** Raw HTML parts when present (ephemeral — never persist). */
export function gmailPayloadToHtml(payload: MimePart | undefined): string {
  const out = emptySink();
  collectParts(payload, out);
  return out.html.join('\n');
}

/**
 * Calendar bodies carried by the message.
 *
 * Inline parts come back decoded; anything Gmail held back is returned as a
 * reference for the caller to fetch, because this module does no I/O.
 */
export function gmailPayloadToCalendar(payload: MimePart | undefined): {
  inline: string[];
  refs: CalendarAttachmentRef[];
} {
  const out = emptySink();
  collectParts(payload, out);
  return { inline: out.calendar, refs: out.calendarRefs };
}

export function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const hit = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value ?? null;
}

/** A file attached to a message: a ticket PDF, a photo, a pass. */
export interface MessageFileRef {
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  /** Gmail holds the bytes behind this id; null when they came inline. */
  attachmentId: string | null;
  /** Base64url bytes when Gmail inlined a small file; null otherwise. */
  inlineData: string | null;
}

/**
 * The files a message carries, for the person to keep with an event.
 *
 * Only parts with a file name are files: the body's own text and HTML parts
 * have none. Calendar invites are left out because the calendar reads those
 * itself (collectCalendar in providers/gmail.ts).
 */
export function gmailPayloadToFiles(payload: MimePart | undefined): MessageFileRef[] {
  const files: MessageFileRef[] = [];
  const walk = (part: MimePart | undefined) => {
    if (!part) return;
    const filename = part.filename?.trim();
    if (filename && !isCalendarPart(part) && (part.body?.attachmentId || part.body?.data)) {
      files.push({
        filename,
        mimeType: (part.mimeType ?? 'application/octet-stream').toLowerCase(),
        sizeBytes: part.body?.size ?? null,
        attachmentId: part.body?.attachmentId ?? null,
        inlineData: part.body?.attachmentId ? null : (part.body?.data ?? null),
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return files;
}
