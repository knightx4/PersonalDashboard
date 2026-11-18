import type { BuildStep } from '@/lib/learn/courses/build';

/** Minutes as "37 hours", "3 hours", "2 hr 57 min" or "45 min". */
export function hours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 600) return `${Math.round(minutes / 60)} hours`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h} hr ${m} min`;
}

/** The stage a build is on: the one running, else the first still waiting. */
export function runningStep(steps: readonly BuildStep[]): BuildStep | null {
  return (
    steps.find((step) => step.state === 'running') ??
    steps.find((step) => step.state === 'failed') ??
    steps.find((step) => step.state === 'waiting') ??
    null
  );
}
