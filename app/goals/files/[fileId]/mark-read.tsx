'use client';

import { useEffect } from 'react';
import { markFileReadAction } from './read-actions';

/**
 * Marks the file read once it is open (plan #1861), with the results linking
 * to it (note be1ed0d3). Draws nothing.
 */
export function MarkFileRead({ fileId, stepIds }: { fileId: string; stepIds: string[] }) {
  const key = stepIds.join(',');
  useEffect(() => {
    void markFileReadAction(fileId, key ? key.split(',') : []);
  }, [fileId, key]);
  return null;
}
