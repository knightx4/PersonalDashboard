'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useReducedMotion } from '@/components/ui/motion';
import { Stat } from '@/components/ui/stat';
import { explorableModel } from '../models/registry';
import { startingValues, type ModelValues } from '../models/types';

/** Where the gallery has moved each model's sliders to, by model id. */
const Moved = createContext<Record<string, ModelValues>>({});

/**
 * Begins the named models' sliders somewhere other than the lesson's start,
 * so the gallery can draw a model after it has been moved: the live caption
 * and the faint starting curves. Nothing outside the gallery uses it.
 */
export function ExplorableMoved({
  moved,
  children,
}: {
  moved: Record<string, ModelValues>;
  children: ReactNode;
}) {
  return <Moved.Provider value={moved}>{children}</Moved.Provider>;
}

/**
 * An explorable model on a lesson (plan #2321.7), as main plus rail: the
 * model's plot, a slider for each parameter and the live caption in the main
 * column, and the numbers read off the plot in a narrow rail beside it on a
 * laptop, after it on a phone. The caption says in a sentence what the
 * sliders have done and changes as they move; it is a polite live region,
 * so a screen reader hears it after each step.
 *
 * The sliders are native range inputs, so arrows, Page Up and Down, Home and
 * End all move them. Asking for reduced motion makes the curves jump to
 * their new place instead of sliding.
 *
 * Only the model's id and its starting values cross from the server: the
 * model itself, with its functions, is read from the registry here.
 */
export function ExplorableView({ modelId, start }: { modelId: string; start: ModelValues }) {
  const moved = useContext(Moved)[modelId];
  const model = explorableModel(modelId);
  const from = model ? startingValues(model, start) : {};
  const [values, setValues] = useState<ModelValues>(() =>
    model ? startingValues(model, moved ?? start) : {},
  );
  // The curves slide only once a slider has moved: on load they are drawn where they stand.
  const [touched, setTouched] = useState(false);
  const move = (next: ModelValues) => {
    setTouched(true);
    setValues(next);
  };
  const reduced = useReducedMotion();
  const id = useId();
  if (!model) return null;
  const { Plot } = model;
  const atStart = model.params.every((param) => values[param.id] === from[param.id]);
  const readouts = model.readouts(values, from);
  const table = model.table(values);
  return (
    <div>
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-start sm:gap-6">
        <div>
          <Plot values={values} from={from} animate={touched && !reduced} />
          <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {model.params.map((param) => {
              const value = values[param.id];
              const words = param.say(value, from[param.id]);
              const inputId = `${id}-${param.id}`;
              return (
                <div key={param.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={inputId} className="text-small font-medium text-ink">
                      {param.label}
                    </label>
                    <span className="text-small text-ink-muted">{words}</span>
                  </div>
                  <input
                    id={inputId}
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={value}
                    aria-valuetext={words}
                    onChange={(event) =>
                      move({ ...values, [param.id]: Number(event.target.value) })
                    }
                    // ui-ok: the hit area is the 44px touch minimum, not a control height
                    className="h-11 w-full cursor-pointer accent-accent"
                  />
                </div>
              );
            })}
          </div>
          <Button variant="link" disabled={atStart} onClick={() => move(from)}>
            Back to the start
          </Button>
          <p aria-live="polite" className="mt-3 text-body text-ink">
            {model.describe(values, from)}
          </p>
        </div>
        <div className="mt-4 sm:mt-8">
          <div className="flex gap-6 sm:flex-col sm:gap-4">
            {readouts.map((readout) => (
              <Stat
                key={readout.label}
                value={readout.value}
                label={
                  <>
                    {readout.label}
                    <span className="block">
                      {readout.was ? `was ${readout.was}` : 'as it started'}
                    </span>
                  </>
                }
              />
            ))}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>{model.label}, as the sliders now stand</caption>
        <thead>
          <tr>
            {table.head.map((cell) => (
              <th key={cell}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, at) => (
                <td key={at}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
