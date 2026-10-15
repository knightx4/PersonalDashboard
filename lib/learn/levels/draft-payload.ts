import { z } from 'zod';
import { MAX_LEVEL } from '@/lib/learn/levels/model';

/**
 * What the drafting call reports, and the draft that is kept from it
 * (docs/LEARN-LEVELS-SPEC.md, "Drafting a topic").
 *
 * Pure: the schema the tool input is read with, and the rules that turn it
 * into rows the tables in learn 0133 will take. The call is in draft.ts and
 * the writes in store.ts; everything that decides what survives is here,
 * where it can be tested without either.
 */

/** Two to four checks a level, as `topic_cells_descriptor_ck` requires. */
export const MIN_CHECKS = 2;
export const MAX_CHECKS = 4;

/** Longest a check may be, so one check stays one observable thing. */
export const MAX_CHECK_LENGTH = 240;

/**
 * Checks that describe a state of mind rather than something an answer can
 * show. The spec's example of what drafting must reject is "Understands DCF
 * well": no answer can meet or fail it. Matched at the start of the check,
 * where these always sit.
 */
const VAGUE_CHECK =
  /^(?:(?:has an?|have an?|shows an?)\s+)?(?:understands?|understanding|knows?|is familiar|familiarity|is aware|awareness|grasps?|appreciates?|is comfortable|has a (?:good|solid|basic|deep|clear) (?:grasp|understanding|sense))\b/i;

export function isVagueCheck(check: string): boolean {
  return VAGUE_CHECK.test(check.trim());
}

const levelNumber = z.number().int().min(1).max(MAX_LEVEL);

export const draftPayloadSchema = z.object({
  too_vague: z.boolean().optional(),
  name: z.string(),
  scope: z.string(),
  ceiling: levelNumber,
  fields: z.array(z.string()).default([]),
  levels: z.array(
    z.object({
      level: levelNumber,
      checks: z.array(z.string()),
    }),
  ),
  links: z
    .array(
      z.object({
        from_level: levelNumber,
        topic: z.string(),
        level: levelNumber,
        why: z.string().optional(),
      }),
    )
    .default([]),
  missing: z
    .array(
      z.object({
        name: z.string(),
        scope: z.string(),
        from_level: levelNumber,
        level: levelNumber,
        why: z.string().optional(),
      }),
    )
    .default([]),
});

export type DraftPayload = z.infer<typeof draftPayloadSchema>;

/** A topic already on the map, as the call is told about it. */
export type MapTopic = {
  id: string;
  name: string;
  scope: string;
  ceiling: number;
  approved: boolean;
};

/** A field from LEARN-AREAS-SPEC, by the slug the call names it with. */
export type FieldOption = { id: string; slug: string; name: string };

export type DraftCell = { level: number; checks: string[] };

/** A link to a topic on the map: `fromLevel` of the draft needs `level` of `topicId`. */
export type DraftLink = {
  fromLevel: number;
  topicId: string;
  topicName: string;
  level: number;
  why: string | null;
};

/** A topic a link needs that the map does not have, kept in `topics.wanted`. */
export type WantedTopic = {
  name: string;
  scope: string;
  from_level: number;
  level: number;
  why: string | null;
};

export type TopicDraft = {
  name: string;
  scope: string;
  ceiling: number;
  fieldIds: string[];
  cells: DraftCell[];
  links: DraftLink[];
  wanted: WantedTopic[];
  /** What the call proposed and the rules dropped, said rather than swallowed. */
  dropped: string[];
};

export type NormaliseResult =
  | { ok: true; draft: TopicDraft }
  | { ok: false; reason: 'too-vague' | 'malformed'; detail: string };

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();
const key = (text: string): string => tidy(text).toLowerCase();

/** A level's checks, tidied, deduplicated and with the vague ones taken out. */
export function keptChecks(checks: readonly string[]): { kept: string[]; vague: string[] } {
  const kept: string[] = [];
  const vague: string[] = [];
  const seen = new Set<string>();
  for (const raw of checks) {
    const check = tidy(raw).slice(0, MAX_CHECK_LENGTH);
    if (check === '' || seen.has(check.toLowerCase())) continue;
    seen.add(check.toLowerCase());
    if (isVagueCheck(check)) vague.push(check);
    else kept.push(check);
  }
  return { kept: kept.slice(0, MAX_CHECKS), vague };
}

/**
 * The draft as it will be written, or why there is none.
 *
 * - Every level from 1 to the ceiling needs two to four checks once vague
 *   ones are dropped; a level that falls short fails the draft, since a
 *   ladder with a hole in it cannot be asked about.
 * - Levels above the ceiling are ignored, as the model ignores them.
 * - A link must name a topic on the map, other than this one, at a level
 *   that topic has, from a level this one has. One that names a topic the
 *   map lacks is kept as wanted when the call also listed it as missing.
 * - Of two links from this topic to one other, the one from the lower level
 *   at the same or a higher required level makes the other redundant (the
 *   level chain carries a link upwards), so only the lowest is kept.
 */
export function normaliseDraft(
  payload: DraftPayload,
  map: readonly MapTopic[],
  fields: readonly FieldOption[],
): NormaliseResult {
  if (payload.too_vague) {
    return {
      ok: false,
      reason: 'too-vague',
      detail: 'Too broad to be one topic. Name the specific thing you want to know, such as DCF rather than finance.',
    };
  }

  const name = tidy(payload.name);
  const scope = tidy(payload.scope);
  if (name === '' || scope === '') {
    return { ok: false, reason: 'malformed', detail: 'The draft came back without a name or a scope.' };
  }

  const ceiling = payload.ceiling;
  const dropped: string[] = [];

  const byLevel = new Map<number, string[]>();
  for (const entry of payload.levels) {
    if (entry.level > ceiling) continue;
    byLevel.set(entry.level, [...(byLevel.get(entry.level) ?? []), ...entry.checks]);
  }

  const cells: DraftCell[] = [];
  for (let level = 1; level <= ceiling; level += 1) {
    const { kept, vague } = keptChecks(byLevel.get(level) ?? []);
    for (const check of vague) dropped.push(`level ${level}: "${check}" (no answer could show it)`);
    if (kept.length < MIN_CHECKS) {
      return {
        ok: false,
        reason: 'malformed',
        detail: `Level ${level} came back with ${kept.length === 0 ? 'no checks' : 'one check'} an answer could meet. Try drafting it again.`,
      };
    }
    cells.push({ level, checks: kept });
  }

  const fieldBySlug = new Map(fields.map((f) => [f.slug.toLowerCase(), f.id]));
  const fieldByName = new Map(fields.map((f) => [f.name.toLowerCase(), f.id]));
  const fieldIds = [
    ...new Set(
      payload.fields.flatMap((given) => {
        const id = fieldBySlug.get(key(given)) ?? fieldByName.get(key(given));
        return id ? [id] : [];
      }),
    ),
  ];

  const mapByName = new Map(map.map((t) => [key(t.name), t]));
  const missingByName = new Map(payload.missing.map((m) => [key(m.name), m]));

  // The lowest-level link to each topic, and the requirement it carries.
  const best = new Map<string, DraftLink>();
  const wanted = new Map<string, WantedTopic>();
  const addWanted = (entry: WantedTopic) => {
    const was = wanted.get(key(entry.name));
    if (!was || entry.from_level < was.from_level) wanted.set(key(entry.name), entry);
  };

  for (const link of payload.links) {
    const topicName = tidy(link.topic);
    if (key(topicName) === key(name)) {
      dropped.push(`a link to ${topicName} itself (the levels already chain)`);
      continue;
    }
    if (link.from_level > ceiling) {
      dropped.push(`a link from level ${link.from_level}, above this topic's ceiling`);
      continue;
    }
    const target = mapByName.get(key(topicName));
    if (!target) {
      const missing = missingByName.get(key(topicName));
      if (missing) {
        addWanted({
          name: tidy(missing.name),
          scope: tidy(missing.scope),
          from_level: link.from_level,
          level: link.level,
          why: link.why ? tidy(link.why) || null : null,
        });
      } else {
        dropped.push(`a link to ${topicName}, which is not on your map`);
      }
      continue;
    }
    if (link.level > target.ceiling) {
      dropped.push(`a link to ${target.name} ${link.level}, above its ceiling of ${target.ceiling}`);
      continue;
    }
    const candidate: DraftLink = {
      fromLevel: link.from_level,
      topicId: target.id,
      topicName: target.name,
      level: link.level,
      why: link.why ? tidy(link.why) || null : null,
    };
    const was = best.get(target.id);
    if (!was || candidate.fromLevel < was.fromLevel || (candidate.fromLevel === was.fromLevel && candidate.level < was.level)) {
      best.set(target.id, candidate);
    }
  }

  // A missing topic no link pointed at still says what the draft leans on.
  for (const missing of payload.missing) {
    const missingName = tidy(missing.name);
    if (missingName === '' || key(missingName) === key(name) || mapByName.has(key(missingName))) continue;
    if (missing.from_level > ceiling) continue;
    addWanted({
      name: missingName,
      scope: tidy(missing.scope),
      from_level: missing.from_level,
      level: missing.level,
      why: missing.why ? tidy(missing.why) || null : null,
    });
  }

  return {
    ok: true,
    draft: {
      name,
      scope,
      ceiling,
      fieldIds,
      cells,
      links: [...best.values()].sort((a, b) => a.fromLevel - b.fromLevel || a.topicName.localeCompare(b.topicName)),
      wanted: [...wanted.values()].filter((w) => w.scope !== ''),
      dropped,
    },
  };
}

/**
 * The checks a person typed for one level, one per line, as they will be
 * stored: tidied, blank lines dropped. Null with the reason when they are not
 * two to four.
 */
export function checksFromText(text: string): { ok: true; checks: string[] } | { ok: false; detail: string } {
  const checks = text
    .split(/\r?\n/)
    .map(tidy)
    .filter((line) => line !== '');
  if (checks.length < MIN_CHECKS) return { ok: false, detail: `needs at least ${MIN_CHECKS} checks, one per line` };
  if (checks.length > MAX_CHECKS) return { ok: false, detail: `takes at most ${MAX_CHECKS} checks` };
  const long = checks.find((check) => check.length > MAX_CHECK_LENGTH);
  if (long) return { ok: false, detail: `has a check over ${MAX_CHECK_LENGTH} characters` };
  return { ok: true, checks };
}

/** Whether two lists of checks say the same thing, ignoring spacing. */
export function sameChecks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((check, i) => tidy(check) === tidy(b[i]));
}

/** `topics.wanted` as read back, keeping only entries of the shape written. */
export function readWanted(value: unknown): WantedTopic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== 'string' || typeof e.scope !== 'string') return [];
    if (typeof e.from_level !== 'number' || typeof e.level !== 'number') return [];
    return [
      {
        name: e.name,
        scope: e.scope,
        from_level: e.from_level,
        level: e.level,
        why: typeof e.why === 'string' ? e.why : null,
      },
    ];
  });
}
