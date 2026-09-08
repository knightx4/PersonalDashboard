/**
 * RFC 5545 parsing, narrowed to what an interview invite actually carries.
 *
 * The reason this exists: the extractor asks a language model to read a date
 * out of prose, and prose is where dates go to become ambiguous. "Thursday at
 * 2" has no year and no zone; "2pm ET" is only a time if you know the date;
 * a reschedule reads exactly like the original invite. Meanwhile the same
 * message carries a text/calendar part stating the instant, the duration, the
 * attendees and the video link as structured data, and says outright whether
 * it is a new booking, a change, or a cancellation.
 *
 * So this is not an enrichment on top of the model's guess. Where an invite
 * exists it replaces the guess, and `dates` from the model becomes the
 * fallback rather than the source.
 *
 * Deliberately not a general iCalendar implementation: no RRULE expansion (an
 * interview does not recur; a weekly standup is not in this inbox), no VTODO,
 * no VTIMEZONE parsing — named zones go through Intl, which is both correct
 * and already installed.
 */

import { toIanaZone } from './windows-zones';

export interface IcsAttendee {
  name: string | null;
  email: string | null;
  /** CHAIR / REQ-PARTICIPANT / OPT-PARTICIPANT, verbatim when present. */
  role: string | null;
}

export interface IcsEvent {
  /** Stable across reschedules. This is what makes an update an update. */
  uid: string | null;
  /** Bumped by the organiser on each revision; older ones are stale. */
  sequence: number;
  method: string | null;
  status: string | null;
  cancelled: boolean;
  summary: string | null;
  description: string | null;
  location: string | null;
  /** Instant of the start, once the zone has been applied. */
  startsAt: Date | null;
  endsAt: Date | null;
  durationMinutes: number | null;
  /** True for VALUE=DATE — a day, not a time. */
  allDay: boolean;
  /** The zone the organiser wrote it in, when they named one. */
  timeZone: string | null;
  organizer: IcsAttendee | null;
  attendees: IcsAttendee[];
  /** Zoom / Meet / Teams / Webex, from the conference property or the body. */
  conferenceUrl: string | null;
}

interface RawProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Undo RFC 5545 line folding.
 *
 * Folding is why a naive line-by-line parse loses half of every long
 * DESCRIPTION: a continuation is a newline followed by one space or tab, and
 * that space is not part of the value.
 */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/** Split at the first colon that is not inside a quoted parameter value. */
function splitAtValueColon(line: string): [string, string] | null {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ':' && !quoted) return [line.slice(0, i), line.slice(i + 1)];
  }
  return null;
}

function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      out += value[i];
      continue;
    }
    const next = value[++i];
    if (next === 'n' || next === 'N') out += '\n';
    else if (next === undefined) out += '\\';
    else out += next; // \, \; \\ and anything else the sender invented
  }
  return out;
}

function parseLine(line: string): RawProperty | null {
  const split = splitAtValueColon(line);
  if (!split) return null;
  const [head, value] = split;

  const segments: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of head) {
    if (char === '"') quoted = !quoted;
    if (char === ';' && !quoted) {
      segments.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  segments.push(current);

  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    params[segment.slice(0, eq).trim().toUpperCase()] = segment
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }

  return { name: segments[0].trim().toUpperCase(), params, value: value.trim() };
}

/**
 * Offset of a zone at an instant, in milliseconds.
 *
 * Formatting the instant in the target zone and reading the wall clock back
 * gives the offset without shipping a timezone database — the one the platform
 * already has is authoritative and stays current through DST rule changes.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - instantMs;
}

/**
 * A wall-clock reading in a named zone, as an instant.
 *
 * Two passes, because the offset depends on the instant we are solving for.
 * The second pass is what gets the hour after a DST transition right; a single
 * pass is off by an hour twice a year, which is exactly when an interview time
 * being wrong is least forgivable.
 */
function wallClockToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string | null,
): Date | null {
  const wallMs = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  if (!Number.isFinite(wallMs)) return null;
  if (!timeZone) return new Date(wallMs);

  // Outlook writes Windows zone names — TZID="Eastern Standard Time" — which
  // `Intl` rejects outright. Translating first is what keeps those invites out
  // of the fallback below, where the hour would silently come out four wrong.
  const zone = toIanaZone(timeZone);
  if (!zone) {
    // An unknown TZID is the sender's bug, not a reason to lose the invite.
    return new Date(wallMs);
  }

  let instant = wallMs - zoneOffsetMs(wallMs, zone);
  instant = wallMs - zoneOffsetMs(instant, zone);
  return new Date(instant);
}

interface ParsedDate {
  at: Date | null;
  allDay: boolean;
  timeZone: string | null;
}

function parseDateProperty(property: RawProperty, defaultTimeZone: string | null): ParsedDate {
  const value = property.value.trim();
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly || property.params.VALUE === 'DATE') {
    const match = dateOnly ?? value.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!match) return { at: null, allDay: true, timeZone: null };
    return {
      at: new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
      allDay: true,
      timeZone: null,
    };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return { at: null, allDay: false, timeZone: null };

  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };

  // A trailing Z is already UTC and any TZID alongside it is noise.
  if (match[7] === 'Z') {
    return { at: wallClockToUtc(wall, null), allDay: false, timeZone: 'UTC' };
  }

  // No zone and no Z is a floating time: the organiser meant local, and the
  // only local we know is the user's own.
  const zone = property.params.TZID || defaultTimeZone;
  return { at: wallClockToUtc(wall, zone ?? null), allDay: false, timeZone: zone ?? null };
}

/** ISO 8601 duration, restricted to what a calendar actually emits. */
export function parseIcsDuration(value: string): number | null {
  const match = value
    .trim()
    .match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total =
    Number(weeks ?? 0) * 10080 +
    Number(days ?? 0) * 1440 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Number(seconds ?? 0) / 60;
  if (total === 0) return null;
  return Math.round(sign === '-' ? -total : total);
}

const CONFERENCE_HOSTS =
  /https?:\/\/[^\s<>"']*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|whereby\.com|webex\.com|chime\.aws|gotomeeting\.com|bluejeans\.com|around\.co|meet\.jit\.si)[^\s<>"'\]),]*/i;

function findConferenceUrl(...candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(CONFERENCE_HOSTS);
    if (match) return match[0].replace(/[.,;]+$/, '');
  }
  return null;
}

function parseCalAddress(property: RawProperty): IcsAttendee {
  const value = property.value.trim();
  const email = value.toLowerCase().startsWith('mailto:')
    ? value.slice(7).trim().toLowerCase()
    : /^[^\s@]+@[^\s@]+$/.test(value)
      ? value.toLowerCase()
      : null;
  const name = property.params.CN?.trim() || null;
  return {
    // A CN that is just the address again is not a name.
    name: name && name.toLowerCase() !== email ? unescapeText(name) : null,
    email,
    role: property.params.ROLE?.trim() || null,
  };
}

export interface ParseIcsOptions {
  /**
   * Applied to floating times only — a DTSTART with neither a Z nor a TZID.
   * The user's profile timezone is the right value; without one the time is
   * read as UTC, which is wrong quietly rather than loudly.
   */
  defaultTimeZone?: string | null;
}

/**
 * Every VEVENT in a calendar body, in document order.
 *
 * Never throws: this runs over mail from arbitrary senders, and a malformed
 * invite should cost us the invite, not the message.
 */
export function parseIcs(text: string, options: ParseIcsOptions = {}): IcsEvent[] {
  if (!text || !/BEGIN:VEVENT/i.test(text)) return [];
  const defaultTimeZone = options.defaultTimeZone ?? null;

  const events: IcsEvent[] = [];
  let method: string | null = null;
  let current: RawProperty[] | null = null;
  let depth = 0;

  for (const line of unfold(text)) {
    const property = parseLine(line);
    if (!property) continue;

    if (property.name === 'BEGIN') {
      const component = property.value.toUpperCase();
      if (component === 'VEVENT' && depth === 0) {
        current = [];
        depth = 1;
      } else if (current) {
        // VALARM and friends: skipped wholesale, so their TRIGGER and
        // DESCRIPTION cannot be mistaken for the event's own.
        depth += 1;
      }
      continue;
    }

    if (property.name === 'END') {
      const component = property.value.toUpperCase();
      if (component === 'VEVENT' && depth === 1 && current) {
        const event = buildEvent(current, method, defaultTimeZone);
        if (event) events.push(event);
        current = null;
        depth = 0;
      } else if (current && depth > 1) {
        depth -= 1;
      }
      continue;
    }

    if (!current && property.name === 'METHOD') {
      method = property.value.trim().toUpperCase();
      continue;
    }

    if (current && depth === 1) current.push(property);
  }

  return events;
}

function buildEvent(
  properties: RawProperty[],
  method: string | null,
  defaultTimeZone: string | null,
): IcsEvent | null {
  const first = (name: string) => properties.find((p) => p.name === name) ?? null;
  const text = (name: string) => {
    const property = first(name);
    return property ? unescapeText(property.value).trim() || null : null;
  };

  const dtStart = first('DTSTART');
  const dtEnd = first('DTEND');
  const start = dtStart ? parseDateProperty(dtStart, defaultTimeZone) : null;
  const end = dtEnd ? parseDateProperty(dtEnd, defaultTimeZone) : null;

  const durationProperty = first('DURATION');
  let durationMinutes = durationProperty ? parseIcsDuration(durationProperty.value) : null;
  if (durationMinutes == null && start?.at && end?.at) {
    const minutes = Math.round((end.at.getTime() - start.at.getTime()) / 60000);
    durationMinutes = minutes > 0 ? minutes : null;
  }

  let endsAt = end?.at ?? null;
  if (!endsAt && start?.at && durationMinutes != null && durationMinutes > 0) {
    endsAt = new Date(start.at.getTime() + durationMinutes * 60000);
  }

  const status = text('STATUS')?.toUpperCase() ?? null;
  const description = text('DESCRIPTION');
  const location = text('LOCATION');

  const organizerProperty = first('ORGANIZER');
  const attendees = properties.filter((p) => p.name === 'ATTENDEE').map(parseCalAddress);

  const conferenceUrl = findConferenceUrl(
    first('X-GOOGLE-CONFERENCE')?.value ?? null,
    location,
    description,
  );

  const sequenceRaw = Number(text('SEQUENCE') ?? '0');

  return {
    uid: text('UID'),
    sequence: Number.isFinite(sequenceRaw) ? sequenceRaw : 0,
    method,
    status,
    cancelled: status === 'CANCELLED' || method === 'CANCEL',
    summary: text('SUMMARY'),
    description,
    location,
    startsAt: start?.at ?? null,
    endsAt,
    durationMinutes,
    allDay: start?.allDay ?? false,
    timeZone: start?.timeZone ?? null,
    organizer: organizerProperty ? parseCalAddress(organizerProperty) : null,
    attendees,
    conferenceUrl,
  };
}

/**
 * The one event worth acting on, when a message carries several.
 *
 * A cancellation wins outright — a message that cancels and re-books is a
 * reschedule, and treating it as a booking leaves the old slot on the board.
 * Otherwise the earliest dated event, which is the interview rather than the
 * "hold this too" placeholder that follows it.
 */
export function primaryEvent(events: IcsEvent[]): IcsEvent | null {
  if (events.length === 0) return null;
  const cancelled = events.find((event) => event.cancelled);
  if (cancelled) return cancelled;
  const dated = events
    .filter((event) => event.startsAt !== null && !event.allDay)
    .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
  return dated[0] ?? events[0];
}
