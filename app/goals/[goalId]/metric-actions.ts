'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadCollectionsForGoal } from '@/lib/goals/collections-store';
import { metricLists, parseMetricForm } from '@/lib/goals/metric-form';
import type { MetricInput } from '@/lib/goals/metrics';
import { addMetric, archiveMetric, updateMetric } from '@/lib/goals/metrics-store';

/**
 * The writes for a goal's metrics (plan #2084.3): add one, change what it
 * counts, and take it off the goal. Each reads the form against the goal's
 * own lists (`parseMetricForm`), as the number's actions do, and returns a
 * sentence to show beside the field at fault rather than throwing. The
 * history is written by the table's trigger, and removing a metric archives
 * it: the records it counted are never touched.
 */

export type MetricActionState = {
  error?: string;
  /** The input the error belongs beside, or absent for the form as a whole. */
  field?: keyof MetricInput;
  done?: number;
};

const Id = z.string().uuid();

function saved(goalId: string): MetricActionState {
  revalidatePath(`/goals/${goalId}`);
  return { done: Date.now() };
}

function refused(result: { field: string | null; error: string }): MetricActionState {
  return result.field ? { error: result.error, field: result.field as keyof MetricInput } : { error: result.error };
}

async function readForm(form: FormData) {
  const client = await createGoalsClient();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) {
    return { ok: false as const, problem: { error: 'Could not tell which goal that was.' } };
  }
  // Only a list serving this goal, and one of its dates, can be picked.
  const lists = metricLists(await loadCollectionsForGoal(client, goalId.data));
  const parsed = parseMetricForm((key) => form.get(key), lists);
  if (!parsed.ok) return { ok: false as const, problem: refused(parsed) };
  return { ok: true as const, client, goalId: goalId.data, input: parsed.value };
}

// latency: pending
export async function addMetricAction(
  _prev: MetricActionState,
  form: FormData,
): Promise<MetricActionState> {
  const user = await requireUser();
  try {
    const read = await readForm(form);
    if (!read.ok) return read.problem;
    const result = await addMetric(read.client, user.id, read.goalId, read.input);
    if (!result.ok) return refused(result);
    return saved(read.goalId);
  } catch {
    return { error: 'The metric could not be added. Try again.' };
  }
}

// latency: pending
export async function changeMetricAction(
  _prev: MetricActionState,
  form: FormData,
): Promise<MetricActionState> {
  await requireUser();
  const metricId = Id.safeParse(form.get('metricId'));
  if (!metricId.success) return { error: 'Could not tell which metric that was.' };
  try {
    const read = await readForm(form);
    if (!read.ok) return read.problem;
    const result = await updateMetric(read.client, metricId.data, read.input);
    if (!result.ok) return refused(result);
    return saved(read.goalId);
  } catch {
    return { error: 'The metric could not be changed. Try again.' };
  }
}

// latency: pending
export async function removeMetricAction(form: FormData): Promise<MetricActionState> {
  await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  const metricId = Id.safeParse(form.get('metricId'));
  if (!goalId.success || !metricId.success) return { error: 'Could not tell which metric that was.' };
  try {
    const removed = await archiveMetric(await createGoalsClient(), metricId.data);
    if (!removed) return { error: 'That metric has already gone. Reload to see it.' };
  } catch {
    return { error: 'The metric could not be removed. Try again.' };
  }
  return saved(goalId.data);
}
