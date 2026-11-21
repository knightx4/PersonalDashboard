/**
 * How a course build is described to the person while it runs. Kept apart
 * from the store so a client component can import it.
 */

export type CourseStatus = 'queued' | 'building' | 'ready' | 'failed';
export type StepState = 'waiting' | 'running' | 'done' | 'failed';

export const BUILD_STEPS = [
  { key: 'inventory', label: 'List every video' },
  { key: 'transcripts', label: 'Fetch every transcript' },
  { key: 'notes', label: 'Read each lecture and write notes' },
  { key: 'design', label: 'Design the lessons across the lectures' },
  { key: 'writing', label: 'Write each stage of lessons' },
  { key: 'review', label: 'Recheck every number, drawing and answer' },
] as const;

/** A build nobody has touched for this long is handed out again, and the page offers to resume it. */
export const BUILD_STALE_MS = 90 * 60 * 1000;

export type StepKey = (typeof BUILD_STEPS)[number]['key'];

export type BuildStep = {
  key: StepKey;
  label: string;
  state: StepState;
  /** What the stage is on, such as "7 of 28". */
  detail: string | null;
  at: string | null;
};

export type CourseProgress = {
  /** From the first shape, when a path of clips was ticked; nothing writes it now. */
  clips: string[];
  /** Steps of the plan finished, by key (`A.2`). */
  lessons: string[];
};

/** The steps a build starts with: all waiting. */
export function freshSteps(): BuildStep[] {
  return BUILD_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    state: 'waiting',
    detail: null,
    at: null,
  }));
}

export function isStepKey(value: string): value is StepKey {
  return BUILD_STEPS.some((step) => step.key === value);
}

/** The id of the playlist a YouTube address names, or null. */
export function playlistIdOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!/(^|\.)youtube\.com$/.test(parsed.hostname) && parsed.hostname !== 'youtu.be') return null;
    const id = parsed.searchParams.get('list');
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
