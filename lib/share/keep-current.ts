/**
 * Keeps an open page current: calls `refresh` when the window regains focus,
 * when the tab becomes visible again, and every `intervalMs` while the tab is
 * visible. Returns the function that removes all three.
 *
 * Apart from the component so a test can drive it with plain stand-ins for the
 * window and the document.
 */
export const SHARE_REFRESH_MS = 60_000;

export interface KeepCurrentWindow {
  addEventListener(type: 'focus', fn: () => void): void;
  removeEventListener(type: 'focus', fn: () => void): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface KeepCurrentDocument {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export function keepCurrent(
  win: KeepCurrentWindow,
  doc: KeepCurrentDocument,
  refresh: () => void,
  intervalMs: number = SHARE_REFRESH_MS,
): () => void {
  const onFocus = () => refresh();
  const whenVisible = () => {
    if (doc.visibilityState === 'visible') refresh();
  };

  win.addEventListener('focus', onFocus);
  doc.addEventListener('visibilitychange', whenVisible);
  const id = win.setInterval(whenVisible, intervalMs);

  return () => {
    win.removeEventListener('focus', onFocus);
    doc.removeEventListener('visibilitychange', whenVisible);
    win.clearInterval(id);
  };
}
