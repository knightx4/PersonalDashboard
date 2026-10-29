import { Fragment } from 'react';
import { TOPIC_LABELS } from '@/lib/you/board-reviews';
import type { TrackRecord } from '@/lib/you/board-scoring';

/**
 * Who has been right about what (plan #2581.10), as rows of the Board tab's
 * surface: a line on how to read the scores, then every advisor with a scored
 * forecast, closest first, their mean Brier score at the end, and each topic
 * under the name with how many were scored and the weight the board now gives
 * them there. Drawn only once a forecast is scored.
 */

/** "Work 0.09, 6 scored, weighs 1.6": one topic, kept in one piece when the line wraps. */
export function topicRecordText(t: TrackRecord['topics'][number]): string {
  return `${TOPIC_LABELS[t.topic]} ${t.brier.toFixed(2)}, ${t.scored} scored${t.weight !== 1 ? `, weighs ${t.weight.toFixed(1)}` : ''}`;
}

export function TrackRecordRows({ records }: { records: readonly TrackRecord[] }) {
  return (
    <>
      <li className="card-pad-x row-pad text-small text-ink-muted">
        How close each advisor’s forecasts came once you said how a decision went. 0 is perfect and 0.25 is a coin
        toss. After five scored on a topic, the board weighs them by it.
      </li>
      {records.map((record) => (
        <li key={record.advisor} className="card-pad-x row-pad flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-ui text-ink [overflow-wrap:anywhere]">{record.name}</p>
            <p className="text-small text-ink-muted">
              {record.topics.map((t, i) => (
                <Fragment key={t.topic}>
                  {i > 0 && ' · '}
                  <span className="whitespace-nowrap">{topicRecordText(t)}</span>
                </Fragment>
              ))}
            </p>
          </div>
          <span className="tabular shrink-0 text-ui text-ink" aria-label={`Mean score ${record.brier.toFixed(2)}`}>
            {record.brier.toFixed(2)}
          </span>
        </li>
      ))}
    </>
  );
}
