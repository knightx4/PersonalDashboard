'use client';

import { Select } from '@/components/ui/field';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { setExcitement } from '@/app/jobs/(app)/pipeline/actions';

/**
 * How much you want this one, set where you are reading about it.
 *
 * The new-role form asked for it once and nothing changed it afterwards, so a
 * rating given on the day you saved the posting stayed after the first call
 * made you keener or cooler. The pipeline's excitement filter reads it, and
 * the board shows it as stars. Same options as the form, shrunk to the header
 * row like the status beside it.
 */
export function ExcitementPicker({
  applicationId,
  excitement,
}: {
  applicationId: string;
  excitement: number | null;
}) {
  const { shown, run, pending, failed } = useOptimisticWrite<number | null, number | null>({
    value: excitement,
    apply: (_current, next) => next,
    write: (next) => setExcitement(applicationId, next),
  });

  return (
    <Select
      value={shown === null ? '' : String(shown)}
      disabled={pending}
      aria-label="Excitement"
      aria-invalid={failed}
      title="How much you want this one"
      onChange={(event) => run(event.target.value === '' ? null : Number(event.target.value))}
      className="h-7 min-h-11 w-auto px-1.5 text-small sm:min-h-0"
    >
      <option value="">Not rated</option>
      {[5, 4, 3, 2, 1].map((level) => (
        <option key={level} value={level}>
          {'★'.repeat(level)}
        </option>
      ))}
    </Select>
  );
}
