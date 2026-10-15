'use client';

import { useId, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { InlineTextarea, Select } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { PaidHint } from '@/components/ui/paid-hint';
import {
  editedPoint,
  movedPoint,
  ROLE_LABELS,
  ROLES,
  shapedPlan,
  withoutPoint,
  type PlanPoint,
  type Role,
  type Shape,
  type Stage,
} from '@/lib/learn/essays/plan';
import { shapeEssayPlan } from './guide-actions';
import { NextStage, type PlanApi } from './essay-stages';
import { lowerFirst } from './essay-plan';

const SHAPE_ACTION = 'app/learn/e/[id]/guide-actions.ts#shapeEssayPlan';

/**
 * Structure (LEARN-ESSAYS-SPEC, "The stages"): the points put in order, each
 * with the part it plays. Suggest shapes asks Dash for two or three ways the
 * essay could run, built around the person's own points, each part saying
 * what it does for the reader and which points go in it. Using one reorders
 * the plan and leaves an empty part wherever none of their points fits, for
 * them to fill. Nothing they wrote is dropped: a point a shape leaves out
 * keeps its place at the end.
 */
export function StructureStage({
  essayId,
  api,
  onStage,
  done,
  initialShapes,
}: {
  essayId: string;
  api: PlanApi;
  onStage: (stage: Stage) => void;
  done: boolean;
  /** Shapes drawn as offered, for the gallery. */
  initialShapes?: Shape[];
}) {
  const [shapes, setShapes] = useState<{ list: Shape[]; fromDash: boolean } | null>(
    initialShapes ? { list: initialShapes, fromDash: true } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [asking, start] = useTransition();
  const points = api.plan.points;
  const numbered = points.filter((p) => p.text.trim());

  const suggest = () =>
    start(async () => {
      setError(null);
      const result = await shapeEssayPlan(essayId).catch(() => undefined);
      if (!result || !result.ok) {
        setError(
          result && !result.ok ? result.error : 'The connection dropped. Try again in a moment.',
        );
        return;
      }
      setShapes({ list: result.shapes, fromDash: result.fromDash });
    });

  const use = (shape: Shape) => {
    api.change({ kind: 'shape', shape }, (now) => shapedPlan(now, shape));
    setShapes(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card padding="none" aria-busy={asking || undefined}>
        <CardSection
          title="Shapes your essay could take"
          hint={
            api.plan.shape
              ? `You are using “${api.plan.shape}”. Ask again to compare others.`
              : 'Ways to order your points so they carry the reader to your thesis.'
          }
          action={
            <span className="flex items-center gap-1">
              <PaidHint action={SHAPE_ACTION} what="Cost of Dash suggesting shapes" />
              <Button
                type="button"
                size="sm"
                variant={api.plan.shape ? 'secondary' : 'primary'}
                pending={asking}
                disabled={asking || numbered.length < 2}
                onClick={suggest}
              >
                {asking ? 'Thinking…' : 'Suggest shapes'}
              </Button>
            </span>
          }
        >
          {numbered.length < 2 && (
            <p className="text-ui text-ink-muted">
              Write at least two points on the Plan step; the shapes are built around them.
            </p>
          )}
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          {shapes && !shapes.fromDash && (
            <p className="text-small text-ink-muted">
              Dash could not be asked just now, so these are three common shapes.
            </p>
          )}
        </CardSection>
        {shapes?.list.map((shape) => (
          <CardSection
            key={shape.name}
            title={shape.name}
            hint={shape.why}
            action={
              <Button type="button" size="sm" variant="secondary" onClick={() => use(shape)}>
                Use this shape
              </Button>
            }
          >
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ui text-ink">
              {shape.parts.map((part, i) => (
                <li key={i}>
                  <span className="font-medium">{ROLE_LABELS[part.role]}</span>
                  <span className="text-ink-muted"> · {part.guide}</span>
                  {part.points.length > 0 ? (
                    <ul className="mt-0.5 text-ink">
                      {part.points.map((id) => {
                        const point = points.find((p) => p.id === id);
                        return point ? (
                          <li key={id} className="line-clamp-2">
                            ↳ {point.text.trim()}
                          </li>
                        ) : null;
                      })}
                    </ul>
                  ) : (
                    <p className="mt-0.5 text-small text-ink-muted">
                      ↳ None of your points yet. You would write this part.
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </CardSection>
        ))}
      </Card>

      <Card padding="none">
        <CardSection
          title="Your outline"
          hint="Top to bottom, the order the reader meets it. Give each part its role, and fill any empty part in your own words."
        >
          {points.length === 0 ? (
            <p className="text-ui text-ink-muted">Your points from the Plan step appear here.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {points.map((point, i) => (
                <OutlineRow
                  key={point.id}
                  point={point}
                  number={i + 1}
                  first={i === 0}
                  last={i === points.length - 1}
                  api={api}
                />
              ))}
            </ol>
          )}
        </CardSection>
      </Card>
      {api.error && (
        <p role="alert" className="text-small text-danger">
          {api.error}
        </p>
      )}

      <NextStage
        stage="structure"
        onStage={onStage}
        ready={done}
        hint="Choose a shape and fill its empty parts, or put the points in order yourself."
      />
    </div>
  );
}

function OutlineRow({
  point,
  number,
  first,
  last,
  api,
}: {
  point: PlanPoint;
  number: number;
  first: boolean;
  last: boolean;
  api: PlanApi;
}) {
  const id = useId();
  const roleId = useId();
  const empty = !point.text.trim();
  return (
    <li className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
      <span
        className="mt-1.5 w-5 shrink-0 text-right text-ui tabular-nums text-ink-muted"
        aria-hidden
      >
        {number}.
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <label htmlFor={roleId} className="sr-only">
            Role of part {number}
          </label>
          <Select
            id={roleId}
            value={point.role}
            onChange={(event) => {
              const role = event.target.value as Role;
              api.change({ kind: 'edit', point: point.id, role }, (now) =>
                editedPoint(now, point.id, { role }),
              );
            }}
            className="w-auto"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          {empty && <span className="text-small text-caution">Empty: write this part’s point</span>}
        </div>
        <label htmlFor={id} className="sr-only">
          Part {number}
        </label>
        <InlineTextarea
          id={id}
          defaultValue={point.text}
          placeholder={
            point.guide ? `In your words: ${lowerFirst(point.guide)}` : 'The point, in your words'
          }
          onBlur={(event) => {
            const text = event.currentTarget.value;
            if (text.trim() !== point.text.trim()) {
              api.change({ kind: 'edit', point: point.id, text }, (now) =>
                editedPoint(now, point.id, { text }),
              );
            }
          }}
          className="-mx-1 mt-1 text-ui text-ink"
        />
        {point.guide && (
          <p className="text-small text-ink-muted">
            What this part does: {lowerFirst(point.guide)}
          </p>
        )}
      </div>
      <span className="flex shrink-0 items-center">
        <IconButton
          size="sm"
          label={`Move part ${number} up`}
          disabled={first}
          onClick={() =>
            api.change({ kind: 'move', point: point.id, by: -1 }, (now) =>
              movedPoint(now, point.id, -1),
            )
          }
        >
          <ArrowUp strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton
          size="sm"
          label={`Move part ${number} down`}
          disabled={last}
          onClick={() =>
            api.change({ kind: 'move', point: point.id, by: 1 }, (now) =>
              movedPoint(now, point.id, 1),
            )
          }
        >
          <ArrowDown strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton
          size="sm"
          label={`Remove part ${number}`}
          onClick={() =>
            api.change({ kind: 'remove', point: point.id }, (now) => withoutPoint(now, point.id))
          }
        >
          <X strokeWidth={1.75} aria-hidden />
        </IconButton>
      </span>
    </li>
  );
}
