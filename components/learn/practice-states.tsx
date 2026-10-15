import { CircleAlert, Layers } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Practice Flow's two states with no question in them, once it asks about
 * topics (plan #2138.6): no approved topic to place you on, and a read that
 * failed. Drawn from props so the gallery shows each.
 */

export const TOPICS_HREF = '/learn/topics';

/** No approved topic, in the whole flow or in the subject it is focused on. */
export function NoTopicToPlace({ subjectName }: { subjectName?: string | null }) {
  return (
    <EmptyState
      icon={Layers}
      title={subjectName ? `No topic in ${subjectName} to place you on yet` : 'No topic to place you on yet'}
      description={
        subjectName
          ? 'Questions come from the topics a subject is made of. Approve one of its topics, and the first few questions here find your level on it.'
          : 'Questions come from your topics, each with ten levels. Approve a topic, and the first few questions here find your level on it.'
      }
      action={{ label: 'Your topics', href: TOPICS_HREF }}
    />
  );
}

/** A read or a write the flow needs failed. The message says which. */
export function PracticeError({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title="The next question could not be chosen"
      description={`${message} Nothing you answered is lost.`}
      action={{ label: 'Try again', href: retryHref }}
    />
  );
}
