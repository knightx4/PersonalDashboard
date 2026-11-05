import { DELETED_OR_MOVED, NoLongerThere } from '@/components/shell/no-longer-there';

/** A page under Chat that could not be found, shown inside the shell. */
export default function NotFound() {
  return <NoLongerThere description={DELETED_OR_MOVED} back={{ label: 'Back to Chat', href: '/chat' }} />;
}
