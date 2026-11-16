'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError, Input } from '@/components/ui/field';
import { addCourse, type AddCourseState } from './actions';

/**
 * Any open course: a playlist's address, or a name for Dash to find. The
 * second line is what the person wants out of it, which decides what the
 * digest keeps; left empty, Dash reads it from what it knows of them.
 */
export function AddCourse() {
  const [state, action, pending] = useActionState<AddCourseState, FormData>(addCourse, {});
  return (
    <Card padding="dense">
      <form action={action} className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="course-what"
            name="what"
            aria-label="A playlist link or a course name"
            placeholder="Paste a YouTube playlist link, or name a course"
            aria-describedby={state.error ? 'course-what-error' : undefined}
            className="min-w-0 flex-1"
            required
          />
          <Button type="submit" pending={pending} className="shrink-0">
            Build it
          </Button>
        </div>
        <Input
          id="course-goal"
          name="goal"
          aria-label="What you want from it"
          placeholder="What do you want from it? (optional)"
        />
        {state.error && <FieldError id="course-what-error">{state.error}</FieldError>}
        <p className="text-small text-ink-muted">
          Dash reads every lecture in full and builds it on your Claude subscription. A long series
          takes an hour or more, and you can leave the page.
        </p>
      </form>
    </Card>
  );
}
