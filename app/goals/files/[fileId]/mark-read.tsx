'use client';

import { useEffect } from 'react';
import { markFileReadAction } from './read-actions';

/** Marks the results linking to this file read once it is open (note be1ed0d3). Draws nothing. */
export function MarkFileRead({ stepIds }: { stepIds: string[] }) {
  const key = stepIds.join(',');
  useEffect(() => {
    if (key) void markFileReadAction(key.split(','));
  }, [key]);
  return null;
}
