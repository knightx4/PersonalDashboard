/**
 * What /api/speak/report writes for one failure (plan #3068): only the
 * fields the player and the output send, each a short string, number or
 * true/false, so a report cannot write anything else into the log.
 */

const FIELDS = [
  'stage',
  'key',
  'status',
  'why',
  'name',
  'message',
  'context',
  'contextStalled',
  'elementOpen',
  'elementPaused',
  'elementReady',
  'audioSession',
] as const;

const LONGEST = 300;

export type SpeechReportLine = Partial<Record<(typeof FIELDS)[number] | 'agent', string | number | boolean | null>>;

export function speechReportLine(body: unknown, agent: string | null): SpeechReportLine | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const given = body as Record<string, unknown>;
  const line: SpeechReportLine = {};
  for (const field of FIELDS) {
    const value = given[field];
    if (typeof value === 'string') line[field] = value.slice(0, LONGEST);
    else if (typeof value === 'number' && Number.isFinite(value)) line[field] = value;
    else if (typeof value === 'boolean' || value === null) line[field] = value;
  }
  if (agent) line.agent = agent.slice(0, LONGEST);
  return line;
}
