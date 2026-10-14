'use client';

import { AddTrigger } from '@/components/ui/add-trigger';

/**
 * File a note from the queue itself (note 0769242a), as the header's notes
 * button does from every other page: capture aimed at a note for Dev (plan
 * #1950.5). The same triage runs once it has saved, so a note filed here is
 * sorted and moved to the ideas page exactly as one filed from the header is.
 * No page path is saved with it, since "/dev/bugs" says nothing about where
 * the problem is.
 */
export function AddNote() {
  return <AddTrigger label="Add a note" aim={{ kind: 'dev-note' }} />;
}
