'use client';

import { DraftNotice, EditForm, RenameForm, SaveError } from '@/app/vault/n/[...path]/note-edit';

/**
 * The note editor open, and the two refusals that come with a way forward
 * (plan #1425). Client-side because the editor's callbacks are functions,
 * which a server render cannot hand across.
 */
export function NoteEditingPreview({ body }: { body: string }) {
  const nothing = () => {};
  return (
    <div className="space-y-8">
      <EditForm
        notePath="Work/Nightly close.md"
        body={body}
        linkPaths={['Work/Nightly close.md']}
        onDone={nothing}
        onReload={nothing}
      />
      <DraftNotice notePath="Work/Nightly close.md" failure={null} />
      <DraftNotice notePath="Work/Nightly close.md" failure="changed" />
      <SaveError
        state={{ reason: 'changed', error: 'This note changed since you opened it.' }}
        onReload={nothing}
      />
      <SaveError
        state={{ reason: 'read-only', error: 'The vault token can read notes but not save them.' }}
        onReload={nothing}
      />
    </div>
  );
}

/**
 * Renaming a note (note 69c302f1): the name box in place of the title, with
 * the note under it as the page leaves it.
 */
export function NoteRenamePreview({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mb-5">
        <RenameForm notePath="Work/Nightly close.md" blobSha="preview" onDone={() => {}} />
      </div>
      {children}
    </>
  );
}
