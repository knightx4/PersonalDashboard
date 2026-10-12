'use client';

import { useState } from 'react';
import { EditableProse } from '@/components/ui/editable-prose';
import { updateNote } from './actions';

/**
 * What you took from it.
 *
 * One optional field, and the first thing this application stores about what
 * somebody learned rather than about what they did. Everything the module is
 * eventually for -- knowing where you already are, so it can stop suggesting
 * the basics -- starts as a pile of these.
 *
 * Optional on purpose. A note the app nags for is a note written to satisfy
 * the app.
 */

/**
 * The note reads as plain text and opens for editing when pressed (plan
 * #1770). Save and Cancel exist only while editing, so a page that is being
 * read carries no form chrome.
 */
export function NoteForm({ readingId, note }: { readingId: string; note: string | null }) {
  // What was last saved here, shown until the revalidated page brings it back.
  const [saved, setSaved] = useState<string | null>(null);

  async function save(next: string): Promise<string | null> {
    const formData = new FormData();
    formData.set('readingId', readingId);
    formData.set('note', next);
    const result = await updateNote({}, formData);
    if (result.error) return result.error;
    setSaved(next);
    return null;
  }

  return (
    <EditableProse
      value={saved ?? note ?? ''}
      onSave={save}
      label="What you took from this reading"
      empty="The one thing worth remembering."
      placeholder="The one thing worth remembering."
    />
  );
}
