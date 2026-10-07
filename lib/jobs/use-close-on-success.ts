import { useState } from 'react';

/**
 * Whether a compose surface is open, closed by the action that succeeded.
 *
 * A form behind a trigger has one failure mode: you add the thing, the list
 * above grows, and the form is still sitting there open looking like it did
 * not take. Closing on the server action's own success message is the whole
 * of it -- errors leave it open, because an error you cannot see the form
 * behind is an error you cannot act on.
 */
export function useCloseOnSuccess(state: {
  error?: string;
  message?: string;
}): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);

  // Watched during render rather than in an effect: an effect would paint the
  // form once more after it had already succeeded, and closing it is not a
  // synchronisation with anything outside React. The seed is what makes it
  // fire on the transition rather than on every render.
  const [seen, setSeen] = useState(state.message);
  if (seen !== state.message) {
    setSeen(state.message);
    if (state.message && !state.error) setOpen(false);
  }

  return [open, setOpen];
}
