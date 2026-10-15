import { LensSkeleton } from './lens-skeleton';

/** Opening a lens: its progress reads the whole topic map before it draws. */
export default function Loading() {
  return <LensSkeleton />;
}
