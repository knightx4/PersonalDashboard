/**
 * A requirement line from a role you pursued, matched to a topic (plan
 * #2184.2). The lines are `roles.requirements` in job_search: what the
 * posting asked for. A topic that sits close to one carries it as its why
 * line ("Asked for in the FP&A Manager role at Acme") and the case written
 * on that topic is set in the posting's terms.
 *
 * This file is the pure half: the shapes, the similarity rule and the two
 * sentences. Reading the roles and embedding is `role-match.ts`.
 */

export type RoleLine = {
  roleId: string;
  roleTitle: string;
  company: string | null;
  line: string;
};

/** Finds the line a topic serves, or null. Never throws. */
export type RoleLineFinder = (topicName: string) => Promise<RoleLine | null>;

/**
 * The cosine a topic and a line must reach to count as the same thing. A
 * starting value for voyage-4-lite: related phrases land around 0.6 to 0.8
 * and unrelated ones under 0.4. Raise it if cards name roles they do not serve.
 */
export const MIN_SIMILARITY = 0.6;

/** Most lines kept to embed, newest roles first. */
export const MAX_LINES = 400;
/** A line longer than this is not a requirement, it is a paragraph. */
const MAX_LINE_CHARS = 300;

export type RawRole = {
  id: string;
  title: string;
  requirements: { text?: unknown; kind?: unknown }[] | null;
  company: { name: string } | null;
};

/** The must-haves and nice-to-haves of the roles, each text once, in role order. */
export function roleLinesFrom(roles: readonly RawRole[]): RoleLine[] {
  const seen = new Set<string>();
  const out: RoleLine[] = [];
  for (const role of roles) {
    if (!Array.isArray(role.requirements)) continue;
    for (const r of role.requirements) {
      if (typeof r.text !== 'string' || (r.kind !== 'must_have' && r.kind !== 'nice_to_have')) continue;
      const line = r.text.replace(/\s+/g, ' ').trim();
      const key = line.toLowerCase();
      if (line === '' || line.length > MAX_LINE_CHARS || seen.has(key)) continue;
      seen.add(key);
      out.push({ roleId: role.id, roleTitle: role.title, company: role.company?.name ?? null, line });
      if (out.length >= MAX_LINES) return out;
    }
  }
  return out;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** The candidate closest to the topic, when it reaches `min`. */
export function bestLine(
  topic: readonly number[],
  candidates: readonly { vector: readonly number[]; line: RoleLine }[],
  min: number = MIN_SIMILARITY,
): RoleLine | null {
  let best: RoleLine | null = null;
  let bestScore = min;
  for (const c of candidates) {
    const score = cosine(topic, c.vector);
    if (score >= bestScore) {
      best = c.line;
      bestScore = score;
    }
  }
  return best;
}

function roleName(role: RoleLine): string {
  return role.company ? `${role.roleTitle} role at ${role.company}` : `${role.roleTitle} role`;
}

function short(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** The sentence added to a card's why line. */
export function roleWhy(role: RoleLine): string {
  return `Asked for in the ${roleName(role)}: “${short(role.line, 160)}”`;
}

/** The lines the case writer is given to set the case in. */
export function roleSituation(role: RoleLine): string[] {
  return [
    `Set the case in the terms of a job posting the person applied to: the ${roleName(role)}.`,
    `The posting asked for: ${short(role.line, 300)}`,
    'Make the situation one a person in that role meets at work. Do not quote the posting line in the case.',
  ];
}
