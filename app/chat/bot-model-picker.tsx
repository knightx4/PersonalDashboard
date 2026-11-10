'use client';

import { useState, useTransition } from 'react';
import { ModelChip } from '@/components/talk/model-chip';
import type { DashChoiceId } from '@/lib/core/models';
import { setBotModel } from '@/lib/dash/model-choice-actions';

/**
 * The model every bot writes with, at the foot of the Bots list (migration
 * 0317): apart from the model Dash answers with, so Dash can stay on Opus
 * while texting runs on Sonnet. The pick shows at once and goes back if the
 * save fails.
 */
export function BotModelPicker({ model }: { model: DashChoiceId }) {
  const [shown, setShown] = useState(model);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-2 pb-3">
      <span className="text-small text-ink-muted">Bots write with</span>
      <ModelChip
        model={shown}
        heading="Bots write with"
        onModel={(next) => {
          const before = shown;
          setShown(next);
          setError(null);
          start(async () => {
            const saved = await setBotModel(next);
            if (!saved.ok) {
              setShown(before);
              setError(saved.error);
            }
          });
        }}
      />
      {error && <p className="w-full text-small text-danger">{error}</p>}
    </div>
  );
}
