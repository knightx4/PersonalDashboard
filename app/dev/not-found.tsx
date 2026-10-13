import { DELETED_OR_MOVED, NoLongerThere } from '@/components/shell/no-longer-there';

/** A row this area's pages could not find, shown inside the shell (plan #1923). */
export default function NotFound() {
  return (
    <NoLongerThere
      description={DELETED_OR_MOVED}
      back={{ label: 'Back to Dev', href: '/dev/raised' }}
    />
  );
}
