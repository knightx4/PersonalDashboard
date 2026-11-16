'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { buildCatalogueCourse } from './actions';

/** Ask Dash to build a catalogue course; the press lands on the course's page, where the build's stages show. */
export function BuildButton({ courseKey }: { courseKey: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      pending={pending}
      onClick={() => start(() => buildCatalogueCourse(courseKey))}
    >
      Build
    </Button>
  );
}
