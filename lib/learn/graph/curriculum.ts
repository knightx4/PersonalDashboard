import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import {
  FIRST_UNITS_MAX,
  FIRST_UNITS_MIN,
  readCurriculum,
  readNextUnit,
  readOutline,
  readUnitDescription,
  type CurriculumResult,
  type CurriculumUnit,
  type NextUnitResult,
  type OutlineResult,
  type UnitDescription,
} from './curriculum-payload';

/**
 * Writing a track's curriculum (LEARN-GRAPH-SPEC, "The curriculum";
 * LEARN-LESSONS-SPEC, "Units are written as you go").
 *
 * A new track gets its first three or four units in one call, given the
 * track's name and what the person asked for when they started it. Each unit
 * is fixed once written. The next unit is written, one call at a time, when the
 * last is done or nearly done (`writeNextUnit`), given the units so far and
 * what the person has shown they know.
 *
 * The first call also says which unit the person's own first question belongs
 * to, so the chain approved alongside it is filed under that unit. A question
 * past the first units is filed under none.
 *
 * A learning goal's track is the exception (plan #1139): it gets its whole
 * outline in one call (`writeOutline`), sized to the goal's depth, and no unit
 * is written after it.
 *
 * A custom track may come with units the person wrote. Then the model keeps
 * them as given and only writes what each covers and its outcome.
 *
 * Sonnet, for the reason the chain generator gives: this is laying out what
 * everybody who teaches the subject already agrees on.
 */

export const CURRICULUM_MODEL = 'claude-sonnet-5';

const TOOL_NAME = 'report_curriculum';

const SYSTEM = `You write the first units of the curriculum for one track of study, at the moment the track is made. Each unit is fixed once written. Later units are written one at a time as the person finishes these, so you are writing where a well-taught course on this subject starts, not the whole course.

You are given the track's name and what the person asked for when they started it. Lay out the opening units, in the order they should be learned.

- ${FIRST_UNITS_MIN} or ${FIRST_UNITS_MAX} units. Each is a real block of study, roughly a week of evenings.
- In teaching order: a unit only depends on units before it.
- Start where the subject starts for an adult who already knows the everyday meaning of the basic terms, so there is no "What is X" unit.
- Each unit is specific: "Price elasticity and tax incidence", not "Key concepts".
- title: under 60 characters.
- covers: one or two sentences naming the ideas the unit teaches.
- outcome: one sentence saying what the person can do once they have learned it, starting with a verb ("Predict who bears a tax from the elasticities on each side").
- goal_unit: the number of the unit the person's own question falls in, counting from 1, or null when it falls past these units.

Plain sentences. No slogans, no "not X, but Y" contrasts, no dashes used for rhythm.

Report through ${TOOL_NAME}.`;

export async function writeCurriculum(input: {
  subject: string;
  /** What the person typed when the track was started, when there was something. */
  asked: string | null;
  /** Units the person wrote themselves, in their order. Kept exactly. */
  units?: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<CurriculumResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: CURRICULUM_MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the units of the curriculum, in teaching order.',
          input_schema: {
            type: 'object',
            properties: {
              units: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    covers: { type: 'string' },
                    outcome: { type: 'string' },
                  },
                  required: ['title', 'covers', 'outcome'],
                },
              },
              goal_unit: { type: ['integer', 'null'] },
            },
            required: ['units', 'goal_unit'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [
        {
          role: 'user',
          content: [
            `The track: ${input.subject}`,
            input.asked
              ? `What they asked for when they started it: ${input.asked}`
              : 'They did not say more than the name.',
            ...(input.units && input.units.length > 0
              ? [
                  '',
                  'They wrote the units themselves. Keep exactly these, with these titles, in this order: add none, drop none, reorder none. Write covers and outcome for each. The count rule does not apply: these are all the units for now.',
                  ...input.units.map((title, index) => `${index + 1}. ${title}`),
                ]
              : []),
            '',
            `Call ${TOOL_NAME}.`,
          ].join('\n'),
        },
      ],
    });
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'The curriculum call failed.',
    };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: CURRICULUM_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find(
    (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
  );
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readCurriculum(block.input, input.units);
}

const OUTLINE_SYSTEM = `You write the whole curriculum for one track of study that the person set as a learning goal. They will see every unit from the start and work through them at their own pace, so this is the complete course from its first unit to its last.

You are given the track's name, what the person asked for, how many units the whole course should have, and any units the track already has. Those units are fixed: the course starts with them, in their order. Write only the units that come after them.

- Each unit is a real block of study, roughly a week of evenings.
- In teaching order: a unit only depends on units before it.
- Where the track has no units yet, start where the subject starts for an adult who already knows the everyday meaning of the basic terms, so there is no "What is X" unit.
- Cover the whole of what was asked, to the depth asked. As the course goes on, reach the parts past the introduction: the standard models, the evidence, how it is applied, and where it is contested.
- Do not repeat a unit the track already has or teach again what it covers.
- Each unit is specific: "Price elasticity and tax incidence", not "Key concepts".
- title: under 60 characters.
- covers: one or two sentences naming the ideas the unit teaches.
- outcome: one sentence saying what the person can do once they have learned it, starting with a verb.

Plain sentences. No slogans, no "not X, but Y" contrasts, no dashes used for rhythm.

Report through ${TOOL_NAME}, with goal_unit null.`;

/** The prompt for a whole outline. Exported so its content is tested without a model. */
export function outlinePrompt(input: {
  subject: string;
  asked: string | null;
  bounds: { min: number; max: number };
  units: readonly CurriculumUnit[];
}): string {
  const had = input.units.length;
  const range =
    had === 0
      ? `The whole course has between ${input.bounds.min} and ${input.bounds.max} units.`
      : `The whole course has between ${input.bounds.min} and ${input.bounds.max} units, counting the ${had} it already has, so write between ${Math.max(1, input.bounds.min - had)} and ${input.bounds.max - had} more.`;
  return [
    `The track: ${input.subject}`,
    input.asked ? `What they asked for: ${input.asked}` : 'They did not say more than the name.',
    range,
    '',
    ...(had > 0
      ? [
          'The units the track already has, fixed, in order:',
          ...input.units.map(
            (unit, index) =>
              `${index + 1}. ${unit.title}${unit.covers ? `. Covers: ${unit.covers}` : ''}${unit.outcome ? ` Outcome: ${unit.outcome}` : ''}`,
          ),
          '',
          'Write only the units after these.',
        ]
      : ['The track has no units yet.']),
    '',
    `Call ${TOOL_NAME}.`,
  ].join('\n');
}

/**
 * The whole outline of a learning goal's track (plan #1139): every unit after
 * the ones it already has, so that together they number between
 * `bounds.min` and `bounds.max`. Returns only the new units.
 */
export async function writeOutline(input: {
  subject: string;
  asked: string | null;
  bounds: { min: number; max: number };
  /** The track's units so far, in order. Kept, and the outline goes after them. */
  units: readonly CurriculumUnit[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<OutlineResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: CURRICULUM_MODEL,
      max_tokens: 6000,
      system: OUTLINE_SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the units of the curriculum, in teaching order.',
          input_schema: {
            type: 'object',
            properties: {
              units: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    covers: { type: 'string' },
                    outcome: { type: 'string' },
                  },
                  required: ['title', 'covers', 'outcome'],
                },
              },
              goal_unit: { type: ['integer', 'null'] },
            },
            required: ['units', 'goal_unit'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: outlinePrompt(input) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The outline call failed.' };
  }

  input.onSpend?.({ model: CURRICULUM_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readOutline(
    block.input,
    input.bounds,
    input.units.map((unit) => unit.title),
  );
}

const NEXT_TOOL_NAME = 'report_next_unit';

const NEXT_SYSTEM = `You write the next unit of one track of study. The track's units so far are fixed, and the person has finished or nearly finished the last of them. Write the one unit a well-taught course on this subject teaches next.

You are given the units so far, in order, with what each covers and its outcome, and what the person has shown: the ideas they know, the ideas they asked to keep working on, and the lessons they rated too hard.

- Build on what they know. Do not repeat a unit or teach again what the units so far cover.
- Where they asked to keep working on ideas or found lessons too hard, the next unit can consolidate or approach them from another side before going further. Where they know everything so far, move on.
- Stay within the subject named by the track. As the course goes on, reach the parts past the introduction: the standard models, the evidence, how it is applied, and where it is contested.
- Specific: "Price elasticity and tax incidence", not "Key concepts".
- title: under 60 characters.
- covers: one or two sentences naming the ideas the unit teaches.
- outcome: one sentence saying what the person can do once they have learned it, starting with a verb.

Plain sentences. No slogans, no "not X, but Y" contrasts, no dashes used for rhythm.

Report through ${NEXT_TOOL_NAME}.`;

/** Ideas named in each list of the prompt, at most, so a long track stays one short call. */
const MAX_NAMED = 40;

function named(label: string, names: readonly string[]): string[] {
  if (names.length === 0) return [`${label}: none yet.`];
  const shown = names.slice(0, MAX_NAMED);
  const more = names.length - shown.length;
  return [`${label}:`, ...shown.map((name) => `- ${name}`), ...(more > 0 ? [`- and ${more} more`] : [])];
}

/** The prompt for the next unit. Exported so its content is tested without a model. */
export function nextUnitPrompt(input: {
  subject: string;
  units: readonly CurriculumUnit[];
  known: readonly string[];
  workingOn: readonly string[];
  tooHard: readonly string[];
}): string {
  return [
    `The track: ${input.subject}`,
    '',
    ...(input.units.length > 0
      ? [
          'The units so far, in order:',
          ...input.units.map(
            (unit, index) =>
              `${index + 1}. ${unit.title}${unit.covers ? `. Covers: ${unit.covers}` : ''}${unit.outcome ? ` Outcome: ${unit.outcome}` : ''}`,
          ),
        ]
      : ['The track has no units yet, so this is its first.']),
    '',
    ...named('Ideas they know', input.known),
    '',
    ...named('Ideas they asked to keep working on', input.workingOn),
    '',
    ...named('Lessons they rated too hard', input.tooHard),
    '',
    `Call ${NEXT_TOOL_NAME}.`,
  ].join('\n');
}

export async function writeNextUnit(input: {
  subject: string;
  units: readonly CurriculumUnit[];
  known: readonly string[];
  workingOn: readonly string[];
  tooHard: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<NextUnitResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: CURRICULUM_MODEL,
      max_tokens: 800,
      system: NEXT_SYSTEM,
      tools: [
        {
          name: NEXT_TOOL_NAME,
          description: 'Report the next unit of the curriculum.',
          input_schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              covers: { type: 'string' },
              outcome: { type: 'string' },
            },
            required: ['title', 'covers', 'outcome'],
          },
        },
      ],
      tool_choice: forceTool(NEXT_TOOL_NAME),
      messages: [{ role: 'user', content: nextUnitPrompt(input) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The next unit call failed.' };
  }

  input.onSpend?.({ model: CURRICULUM_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === NEXT_TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readNextUnit(
    block.input,
    input.units.map((unit) => unit.title),
  );
}

const DESCRIBE_TOOL_NAME = 'report_unit';

const DESCRIBE_SYSTEM = `You describe one unit the person added by name to the outline of a track they are studying. They chose the unit and its title; you write what it covers and what they can do once it is learned.

You are given the track's name, its other units in order with what each covers, and the title of the unit they added.

- Keep to what the title names. Where it overlaps another unit, say what this one adds.
- covers: one or two sentences naming the ideas the unit teaches.
- outcome: one sentence saying what the person can do once they have learned it, starting with a verb.

Plain sentences. No slogans, no "not X, but Y" contrasts, no dashes used for rhythm.

Report through ${DESCRIBE_TOOL_NAME}.`;

/** The prompt for a unit added by name. Exported so its content is tested without a model. */
export function describeUnitPrompt(input: {
  subject: string;
  units: readonly CurriculumUnit[];
  title: string;
}): string {
  return [
    `The track: ${input.subject}`,
    '',
    ...(input.units.length > 0
      ? [
          'Its other units, in order:',
          ...input.units.map(
            (unit, index) => `${index + 1}. ${unit.title}${unit.covers ? `. Covers: ${unit.covers}` : ''}`,
          ),
        ]
      : ['It has no other units.']),
    '',
    `The unit they added: ${input.title}`,
    '',
    `Call ${DESCRIBE_TOOL_NAME}.`,
  ].join('\n');
}

/**
 * What a unit the person added by name covers, and its outcome (plan #1144).
 * The title stays theirs; one Sonnet call writes the other two lines, as the
 * custom-track path does for units a person wrote.
 */
export async function describeUnit(input: {
  subject: string;
  units: readonly CurriculumUnit[];
  title: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<UnitDescription> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: CURRICULUM_MODEL,
      max_tokens: 600,
      system: DESCRIBE_SYSTEM,
      tools: [
        {
          name: DESCRIBE_TOOL_NAME,
          description: 'Report what the unit covers and its outcome.',
          input_schema: {
            type: 'object',
            properties: {
              covers: { type: 'string' },
              outcome: { type: 'string' },
            },
            required: ['covers', 'outcome'],
          },
        },
      ],
      tool_choice: forceTool(DESCRIBE_TOOL_NAME),
      messages: [{ role: 'user', content: describeUnitPrompt(input) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The unit call failed.' };
  }

  input.onSpend?.({ model: CURRICULUM_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === DESCRIBE_TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readUnitDescription(block.input);
}
