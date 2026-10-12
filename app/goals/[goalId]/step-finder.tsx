'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input, PressLabel } from '@/components/ui/field';
import { stepHref } from '@/lib/goals/all-goals';
import type { StepNode } from '@/lib/goals/steps';
import { findSteps } from '@/lib/goals/find-steps';

/** Matches listed at once; a longer query narrows it. */
const SHOWN = 8;

/**
 * A box that finds a step in this goal by its words (note 2b5c2b90): its
 * title, what it involves or when it is done, at any depth and closed or not.
 * Each match opens the step's own page.
 */
export function StepFinder({ goalId, steps }: { goalId: string; steps: StepNode[] }) {
  const [query, setQuery] = useState('');
  const id = useId();
  const found = useMemo(() => findSteps(steps, query), [steps, query]);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-1">
      <div className="relative sm:max-w-xs">
        <PressLabel htmlFor={id} />
        <Input
          id={id}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder="Find a step"
          aria-label="Find a step in this goal"
          className="relative w-full"
        />
      </div>
      {searching && (
        <div role="status" className="space-y-1">
          {found.length === 0 ? (
            <p className="px-1 text-small text-ink-muted">No step matches.</p>
          ) : (
            <Card padding="none">
              <ul className="divide-y divide-border">
                {found.slice(0, SHOWN).map(({ step, path }) => (
                  <li key={step.id}>
                    <Link
                      href={stepHref(goalId, step.id)}
                      className="card-pad-x row-pad block transition-colors duration-quick hover:bg-sunken"
                    >
                      <span className="block text-ui text-ink">{step.title}</span>
                      {(path.length > 0 || step.status !== 'open') && (
                        <span className="block truncate text-small text-ink-muted">
                          {[...path, step.status !== 'open' ? step.status : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {found.length > SHOWN && (
            <p className="px-1 text-small text-ink-muted">
              {found.length - SHOWN} more; add a word to narrow it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
