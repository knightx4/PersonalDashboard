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
  { key: 'synthesis', label: 'Work out what matters across the lectures' },
  { key: 'verify', label: 'Check every number and link' },
] as const;

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
  /** Path clips watched, by their position in the path. */
  clips: string[];
  /** Lessons finished, by key. */
  lessons: string[];
};

/** The steps a build starts with: all waiting. */
export function freshSteps(): BuildStep[] {
  return BUILD_STEPS.map((step) => ({ key: step.key, label: step.label, state: 'waiting', detail: null, at: null }));
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
